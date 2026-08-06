import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  isoDayToDate,
  reviewDependencyChangesSchema,
  reviewMilestoneChangesSchema,
  reviewRiskChangesSchema,
  reviewTaskChangesSchema,
  type ReviewItem,
} from "./schemas";
import { GenerationRequestError } from "./service";
import { wouldCreateDependencyCycle } from "@/lib/pm/rules";

interface ReviewContext {
  workspaceId: string;
  projectId: string;
  runId: string;
  userId: string;
}

function isSerializationConflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2034"
  );
}

async function serializableReviewTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  let lastConflict: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        timeout: 20_000,
        isolationLevel: "Serializable",
      });
    } catch (error) {
      if (!isSerializationConflict(error)) throw error;
      lastConflict = error;
    }
  }
  throw lastConflict;
}

function invalidInput(result: {
  success: false;
  error: { issues: Array<{ message: string }> };
}): never {
  throw new GenerationRequestError(
    result.error.issues[0]?.message ?? "Invalid review changes",
    400,
  );
}

async function requireDraftRun(context: ReviewContext) {
  const run = await prisma.generationRun.findFirst({
    where: {
      id: context.runId,
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      type: "project_plan",
    },
    select: { id: true, status: true },
  });
  if (!run) throw new GenerationRequestError("Plan run not found", 404);
  if (run.status !== "draft") {
    throw new GenerationRequestError(
      "Only the active draft plan can be changed",
      409,
    );
  }
  return run;
}

export async function editDraftProposal(
  context: ReviewContext,
  item: ReviewItem,
  changes: Record<string, unknown>,
) {
  await requireDraftRun(context);
  const scope = {
    id: item.id,
    workspaceId: context.workspaceId,
    projectId: context.projectId,
    generationRunId: context.runId,
    source: "ai_suggested" as const,
    generationStatus: "draft" as const,
  };

  if (item.kind === "task") {
    const parsed = reviewTaskChangesSchema.safeParse(changes);
    if (!parsed.success) invalidInput(parsed);
    const existing = await prisma.task.findFirst({
      where: scope,
      select: {
        id: true,
        startDate: true,
        dueDate: true,
        statusId: true,
        status: { select: { id: true, key: true, category: true } },
        milestoneId: true,
        citations: {
          where: { purpose: "milestone_link" },
          select: { id: true, documentChunkId: true },
        },
      },
    });
    if (!existing) throw new GenerationRequestError("Draft task not found", 404);
    const data = parsed.data;
    const startDate =
      data.startDate !== undefined
        ? isoDayToDate(data.startDate)
        : existing.startDate;
    const dueDate =
      data.dueDate !== undefined ? isoDayToDate(data.dueDate) : existing.dueDate;
    if (startDate && dueDate && startDate.getTime() > dueDate.getTime()) {
      throw new GenerationRequestError(
        "Start date must be on or before the due date",
        400,
      );
    }

    let nextStatusId: string | undefined;
    let nextCategory = existing.status.category;
    if (data.status !== undefined) {
      // Review still edits by the classic key; resolve to this project's column.
      const boardStatus = await prisma.projectTaskStatus.findFirst({
        where: {
          workspaceId: context.workspaceId,
          projectId: context.projectId,
          key: data.status,
        },
        select: { id: true, category: true },
      });
      if (!boardStatus) {
        throw new GenerationRequestError(
          `Status “${data.status}” is not configured on this project`,
          400,
        );
      }
      nextStatusId = boardStatus.id;
      nextCategory = boardStatus.category;
    }

    if (data.milestoneId) {
      const milestone = await prisma.milestone.findFirst({
        where: {
          id: data.milestoneId,
          workspaceId: context.workspaceId,
          projectId: context.projectId,
          generationRunId: context.runId,
          source: "ai_suggested",
          generationStatus: { in: ["draft", "approved"] },
        },
        select: {
          id: true,
          citations: { select: { documentChunkId: true } },
        },
      });
      if (!milestone) {
        throw new GenerationRequestError("Linked milestone not found", 404);
      }
      const targetEvidence = new Set(
        milestone.citations.map((citation) => citation.documentChunkId),
      );
      if (
        existing.citations.length === 0 ||
        (data.milestoneId !== existing.milestoneId &&
          !existing.citations.some((citation) =>
            targetEvidence.has(citation.documentChunkId),
          ))
      ) {
        throw new GenerationRequestError(
          "This task has no source evidence supporting that milestone association",
          400,
        );
      }
    }
    return prisma.$transaction(async (tx) => {
      if (data.milestoneId === null && existing.milestoneId !== null) {
        await tx.taskCitation.deleteMany({
          where: { taskId: existing.id, purpose: "milestone_link" },
        });
      }
      const completedAt =
        nextStatusId === undefined || nextCategory === existing.status.category
          ? undefined
          : nextCategory === "done"
            ? new Date()
            : null;
      const updated = await tx.task.updateMany({
        where: scope,
        data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(nextStatusId !== undefined
          ? {
              statusId: nextStatusId,
              ...(completedAt !== undefined ? { completedAt } : {}),
            }
          : {}),
        ...(data.priority !== undefined ? { priority: data.priority } : {}),
        ...(data.startDate !== undefined
          ? { startDate: isoDayToDate(data.startDate) }
          : {}),
        ...(data.dueDate !== undefined
          ? { dueDate: isoDayToDate(data.dueDate) }
          : {}),
          ...(data.milestoneId !== undefined
            ? { milestoneId: data.milestoneId }
            : {}),
        },
      });
      if (updated.count !== 1) {
        throw new GenerationRequestError(
          "This task was reviewed by someone else",
          409,
        );
      }
      return { id: existing.id };
    });
  }

  if (item.kind === "milestone") {
    const parsed = reviewMilestoneChangesSchema.safeParse(changes);
    if (!parsed.success) invalidInput(parsed);
    const existing = await prisma.milestone.findFirst({
      where: scope,
      select: { id: true, status: true },
    });
    if (!existing) {
      throw new GenerationRequestError("Draft milestone not found", 404);
    }
    const data = parsed.data;
    const updated = await prisma.milestone.updateMany({
      where: scope,
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.targetDate !== undefined
          ? { targetDate: isoDayToDate(data.targetDate) }
          : {}),
        ...(data.status !== undefined
          ? {
              status: data.status,
              completedAt:
                data.status === "completed"
                  ? existing.status === "completed"
                    ? undefined
                    : new Date()
                  : null,
            }
          : {}),
      },
    });
    if (updated.count !== 1) {
      throw new GenerationRequestError(
        "This milestone was reviewed by someone else",
        409,
      );
    }
    return { id: existing.id };
  }

  if (item.kind === "risk") {
    const parsed = reviewRiskChangesSchema.safeParse(changes);
    if (!parsed.success) invalidInput(parsed);
    const existing = await prisma.projectRisk.findFirst({
      where: scope,
      select: {
        id: true,
        milestoneId: true,
        citations: {
          where: { purpose: "milestone_link" },
          select: { id: true, documentChunkId: true },
        },
      },
    });
    if (!existing) throw new GenerationRequestError("Draft risk not found", 404);
    const data = parsed.data;
    if (data.milestoneId) {
      const milestone = await prisma.milestone.findFirst({
        where: {
          id: data.milestoneId,
          workspaceId: context.workspaceId,
          projectId: context.projectId,
          generationRunId: context.runId,
          source: "ai_suggested",
          generationStatus: { in: ["draft", "approved"] },
        },
        select: {
          id: true,
          citations: { select: { documentChunkId: true } },
        },
      });
      if (!milestone) {
        throw new GenerationRequestError("Linked milestone not found", 404);
      }
      const targetEvidence = new Set(
        milestone.citations.map((citation) => citation.documentChunkId),
      );
      if (
        existing.citations.length === 0 ||
        (data.milestoneId !== existing.milestoneId &&
          !existing.citations.some((citation) =>
            targetEvidence.has(citation.documentChunkId),
          ))
      ) {
        throw new GenerationRequestError(
          "This risk has no source evidence supporting that milestone association",
          400,
        );
      }
    }
    return prisma.$transaction(async (tx) => {
      if (data.milestoneId === null && existing.milestoneId !== null) {
        await tx.riskCitation.deleteMany({
          where: { riskId: existing.id, purpose: "milestone_link" },
        });
      }
      const updated = await tx.projectRisk.updateMany({
        where: scope,
        data: {
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.impact !== undefined ? { impact: data.impact } : {}),
        ...(data.likelihood !== undefined
          ? { likelihood: data.likelihood }
          : {}),
        ...(data.mitigation !== undefined
          ? { mitigation: data.mitigation }
          : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.milestoneId !== undefined
            ? { milestoneId: data.milestoneId }
            : {}),
        },
      });
      if (updated.count !== 1) {
        throw new GenerationRequestError(
          "This risk was reviewed by someone else",
          409,
        );
      }
      return { id: existing.id };
    });
  }

  const parsed = reviewDependencyChangesSchema.safeParse(changes);
  if (!parsed.success) invalidInput(parsed);
  const dependency = await prisma.taskDependency.findFirst({
    where: {
      id: item.id,
      workspaceId: context.workspaceId,
      generationRunId: context.runId,
      source: "ai_suggested",
      generationStatus: "draft",
      task: { projectId: context.projectId },
    },
    select: { id: true, taskId: true, dependsOnTaskId: true },
  });
  if (!dependency) {
    throw new GenerationRequestError("Draft dependency not found", 404);
  }

  const nextTaskId = parsed.data.taskId ?? dependency.taskId;
  const nextDependsOnTaskId =
    parsed.data.dependsOnTaskId ?? dependency.dependsOnTaskId;
  if (nextTaskId === nextDependsOnTaskId) {
    throw new GenerationRequestError("A task cannot depend on itself", 400);
  }
  const endpointCount = await prisma.task.count({
    where: {
      id: { in: [nextTaskId, nextDependsOnTaskId] },
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      generationRunId: context.runId,
      source: "ai_suggested",
      generationStatus: { in: ["draft", "approved"] },
    },
  });
  if (endpointCount !== 2) {
    throw new GenerationRequestError(
      "Dependency tasks must belong to this generated plan",
      400,
    );
  }

  const edges = await prisma.taskDependency.findMany({
    where: {
      workspaceId: context.workspaceId,
      generationStatus: { in: ["not_applicable", "draft", "approved"] },
      task: { projectId: context.projectId },
      NOT: { id: dependency.id },
    },
    select: { taskId: true, dependsOnTaskId: true },
  });
  if (
    wouldCreateDependencyCycle(edges, {
      taskId: nextTaskId,
      dependsOnTaskId: nextDependsOnTaskId,
    })
  ) {
    throw new GenerationRequestError(
      "That dependency would create a cycle",
      400,
    );
  }

  try {
    const updated = await prisma.taskDependency.updateMany({
      where: {
        id: dependency.id,
        workspaceId: context.workspaceId,
        generationRunId: context.runId,
        generationStatus: "draft",
      },
      data: { taskId: nextTaskId, dependsOnTaskId: nextDependsOnTaskId },
    });
    if (updated.count !== 1) {
      throw new GenerationRequestError(
        "This dependency was reviewed by someone else",
        409,
      );
    }
    return { id: dependency.id };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2002"
    ) {
      throw new GenerationRequestError("That dependency already exists", 409);
    }
    throw error;
  }
}

type LoadedReviewItem = ReviewItem & {
  milestoneId?: string | null;
  taskId?: string;
  dependsOnTaskId?: string;
};

export async function reviewDraftProposals(
  context: ReviewContext,
  action: "approve" | "reject",
  requestedItems: ReviewItem[],
) {
  await requireDraftRun(context);
  const unique = new Map(
    requestedItems.map((item) => [`${item.kind}:${item.id}`, item]),
  );
  const items = [...unique.values()];
  const now = new Date();

  return serializableReviewTransaction(
    async (tx) => {
      const liveRun = await tx.generationRun.findFirst({
        where: {
          id: context.runId,
          workspaceId: context.workspaceId,
          projectId: context.projectId,
          type: "project_plan",
        },
        select: { status: true },
      });
      if (!liveRun) throw new GenerationRequestError("Plan run not found", 404);
      if (liveRun.status !== "draft") {
        throw new GenerationRequestError(
          "Only the active draft plan can be changed",
          409,
        );
      }

      const [milestones, tasks, risks, dependencies] = await Promise.all([
        tx.milestone.findMany({
          where: {
            workspaceId: context.workspaceId,
            projectId: context.projectId,
            generationRunId: context.runId,
            source: "ai_suggested",
          },
          select: { id: true, generationStatus: true },
        }),
        tx.task.findMany({
          where: {
            workspaceId: context.workspaceId,
            projectId: context.projectId,
            generationRunId: context.runId,
            source: "ai_suggested",
          },
          select: { id: true, generationStatus: true, milestoneId: true },
        }),
        tx.projectRisk.findMany({
          where: {
            workspaceId: context.workspaceId,
            projectId: context.projectId,
            generationRunId: context.runId,
            source: "ai_suggested",
          },
          select: { id: true, generationStatus: true, milestoneId: true },
        }),
        tx.taskDependency.findMany({
          where: {
            workspaceId: context.workspaceId,
            generationRunId: context.runId,
            source: "ai_suggested",
            task: { projectId: context.projectId },
          },
          select: {
            id: true,
            generationStatus: true,
            taskId: true,
            dependsOnTaskId: true,
          },
        }),
      ]);

      const loaded = new Map<string, LoadedReviewItem & { generationStatus: string }>();
      for (const item of milestones) {
        loaded.set(`milestone:${item.id}`, { kind: "milestone", ...item });
      }
      for (const item of tasks) {
        loaded.set(`task:${item.id}`, { kind: "task", ...item });
      }
      for (const item of risks) {
        loaded.set(`risk:${item.id}`, { kind: "risk", ...item });
      }
      for (const item of dependencies) {
        loaded.set(`dependency:${item.id}`, { kind: "dependency", ...item });
      }

      const chosen: LoadedReviewItem[] = [];
      for (const item of items) {
        const match = loaded.get(`${item.kind}:${item.id}`);
        if (!match) {
          throw new GenerationRequestError("Draft proposal not found", 404);
        }
        if (match.generationStatus !== "draft") {
          throw new GenerationRequestError(
            "Only draft proposals can be reviewed",
            409,
          );
        }
        chosen.push(match);
      }

      if (action === "approve") {
        const selectedTasks = new Set(
          chosen.filter((item) => item.kind === "task").map((item) => item.id),
        );
        const selectedMilestones = new Set(
          chosen
            .filter((item) => item.kind === "milestone")
            .map((item) => item.id),
        );
        const milestoneStatus = new Map(
          milestones.map((item) => [item.id, item.generationStatus]),
        );
        const taskStatus = new Map(
          tasks.map((item) => [item.id, item.generationStatus]),
        );

        for (const item of chosen) {
          if (
            (item.kind === "task" || item.kind === "risk") &&
            item.milestoneId &&
            milestoneStatus.get(item.milestoneId) !== "approved" &&
            !selectedMilestones.has(item.milestoneId)
          ) {
            throw new GenerationRequestError(
              "Approve a linked milestone together with its task or risk",
              409,
            );
          }
          if (
            item.kind === "dependency" &&
            item.taskId &&
            item.dependsOnTaskId &&
            (taskStatus.get(item.taskId) !== "approved" &&
              !selectedTasks.has(item.taskId) ||
              taskStatus.get(item.dependsOnTaskId) !== "approved" &&
                !selectedTasks.has(item.dependsOnTaskId))
          ) {
            throw new GenerationRequestError(
              "Approve both dependency tasks together with the dependency",
              409,
            );
          }
        }
      }

      // On rejection, explicitly selected edges go first. Rejecting a task also
      // rejects its remaining draft edges; processing the task first would make
      // a later selected edge look like a concurrent-review conflict.
      const reviewOrder =
        action === "reject"
          ? [...chosen].sort(
              (a, b) =>
                Number(b.kind === "dependency") -
                Number(a.kind === "dependency"),
            )
          : chosen;

      for (const item of reviewOrder) {
        const data = {
          generationStatus: action === "approve" ? "approved" as const : "rejected" as const,
          reviewedAt: now,
          reviewedById: context.userId,
        };
        if (item.kind === "milestone") {
          if (action === "reject") {
            const [linkedTasks, linkedRisks] = await Promise.all([
              tx.task.findMany({
                where: {
                  workspaceId: context.workspaceId,
                  projectId: context.projectId,
                  generationRunId: context.runId,
                  source: "ai_suggested",
                  generationStatus: "draft",
                  milestoneId: item.id,
                },
                select: { id: true },
              }),
              tx.projectRisk.findMany({
                where: {
                  workspaceId: context.workspaceId,
                  projectId: context.projectId,
                  generationRunId: context.runId,
                  source: "ai_suggested",
                  generationStatus: "draft",
                  milestoneId: item.id,
                },
                select: { id: true },
              }),
            ]);
            await Promise.all([
              tx.task.updateMany({
                where: {
                  id: { in: linkedTasks.map((task) => task.id) },
                  workspaceId: context.workspaceId,
                  projectId: context.projectId,
                  generationRunId: context.runId,
                  source: "ai_suggested",
                  generationStatus: "draft",
                },
                data: { milestoneId: null },
              }),
              tx.projectRisk.updateMany({
                where: {
                  id: { in: linkedRisks.map((risk) => risk.id) },
                  workspaceId: context.workspaceId,
                  projectId: context.projectId,
                  generationRunId: context.runId,
                  source: "ai_suggested",
                  generationStatus: "draft",
                },
                data: { milestoneId: null },
              }),
              tx.taskCitation.deleteMany({
                where: {
                  taskId: { in: linkedTasks.map((task) => task.id) },
                  workspaceId: context.workspaceId,
                  purpose: "milestone_link",
                },
              }),
              tx.riskCitation.deleteMany({
                where: {
                  riskId: { in: linkedRisks.map((risk) => risk.id) },
                  workspaceId: context.workspaceId,
                  purpose: "milestone_link",
                },
              }),
            ]);
          }
          const updated = await tx.milestone.updateMany({
            where: {
              id: item.id,
              workspaceId: context.workspaceId,
              projectId: context.projectId,
              generationRunId: context.runId,
              source: "ai_suggested",
              generationStatus: "draft",
            },
            data,
          });
          if (updated.count !== 1) {
            throw new GenerationRequestError(
              "This milestone was reviewed by someone else",
              409,
            );
          }
        } else if (item.kind === "task") {
          const updated = await tx.task.updateMany({
            where: {
              id: item.id,
              workspaceId: context.workspaceId,
              projectId: context.projectId,
              generationRunId: context.runId,
              source: "ai_suggested",
              generationStatus: "draft",
            },
            data,
          });
          if (updated.count !== 1) {
            throw new GenerationRequestError(
              "This task was reviewed by someone else",
              409,
            );
          }
          if (action === "reject") {
            await tx.taskDependency.updateMany({
              where: {
                workspaceId: context.workspaceId,
                generationRunId: context.runId,
                source: "ai_suggested",
                generationStatus: "draft",
                task: { projectId: context.projectId },
                OR: [{ taskId: item.id }, { dependsOnTaskId: item.id }],
              },
              data,
            });
          }
        } else if (item.kind === "risk") {
          const updated = await tx.projectRisk.updateMany({
            where: {
              id: item.id,
              workspaceId: context.workspaceId,
              projectId: context.projectId,
              generationRunId: context.runId,
              source: "ai_suggested",
              generationStatus: "draft",
            },
            data,
          });
          if (updated.count !== 1) {
            throw new GenerationRequestError(
              "This risk was reviewed by someone else",
              409,
            );
          }
        } else {
          const updated = await tx.taskDependency.updateMany({
            where: {
              id: item.id,
              workspaceId: context.workspaceId,
              generationRunId: context.runId,
              source: "ai_suggested",
              generationStatus: "draft",
              task: { projectId: context.projectId },
            },
            data,
          });
          if (updated.count !== 1) {
            throw new GenerationRequestError(
              "This dependency was reviewed by someone else",
              409,
            );
          }
        }
      }

      const counts = await Promise.all([
        tx.milestone.groupBy({
          by: ["generationStatus"],
          where: {
            workspaceId: context.workspaceId,
            projectId: context.projectId,
            generationRunId: context.runId,
          },
          _count: true,
        }),
        tx.task.groupBy({
          by: ["generationStatus"],
          where: {
            workspaceId: context.workspaceId,
            projectId: context.projectId,
            generationRunId: context.runId,
          },
          _count: true,
        }),
        tx.projectRisk.groupBy({
          by: ["generationStatus"],
          where: {
            workspaceId: context.workspaceId,
            projectId: context.projectId,
            generationRunId: context.runId,
          },
          _count: true,
        }),
        tx.taskDependency.groupBy({
          by: ["generationStatus"],
          where: {
            workspaceId: context.workspaceId,
            generationRunId: context.runId,
            task: { projectId: context.projectId },
          },
          _count: true,
        }),
      ]);
      let draft = 0;
      let approved = 0;
      let rejected = 0;
      for (const groups of counts) {
        for (const group of groups) {
          if (group.generationStatus === "draft") draft += group._count;
          if (group.generationStatus === "approved") approved += group._count;
          if (group.generationStatus === "rejected") rejected += group._count;
        }
      }

      const status =
        draft > 0
          ? "draft" as const
          : approved > 0 && rejected > 0
            ? "partially_approved" as const
            : approved > 0
              ? "approved" as const
              : "rejected" as const;
      return tx.generationRun.update({
        where: { id: context.runId },
        data: {
          status,
          approvedAt: status === "approved" ? now : null,
        },
        select: { id: true, status: true, approvedAt: true },
      });
    },
  );
}
