import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  getChatProvider,
  getEmbeddingProvider,
  type ChatProvider,
  type EmbeddingProvider,
} from "@/lib/providers";
import { buildLabelledContext, selectPlanContext } from "./context";
import {
  buildPlanUserMessage,
  extractJsonObject,
  PROJECT_PLAN_PROMPT_VERSION,
  PROJECT_PLAN_SYSTEM_PROMPT,
} from "./prompt";
import { isoDayToDate, modelProjectPlanSchema } from "./schemas";
import {
  PlanValidationError,
  validateProjectPlan,
  type ValidatedProjectPlan,
} from "./validate";

export class GenerationRequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 422,
  ) {
    super(message);
    this.name = "GenerationRequestError";
  }
}

export interface GenerateProjectPlanDeps {
  chat?: ChatProvider;
  embeddings?: EmbeddingProvider;
}

export interface GenerateProjectPlanInput {
  workspaceId: string;
  projectId: string;
  userId: string;
  documentIds: string[];
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function rawAttempts(attempts: string[]) {
  return attempts.length === 0 ? null : JSON.stringify({ attempts });
}

function parsePlan(raw: string) {
  let value: unknown;
  try {
    value = JSON.parse(extractJsonObject(raw));
  } catch {
    return null;
  }
  const parsed = modelProjectPlanSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export async function generateProjectPlan(
  input: GenerateProjectPlanInput,
  deps: GenerateProjectPlanDeps = {},
) {
  const { workspaceId, projectId, userId, documentIds } = input;

  const documents = await prisma.document.findMany({
    where: {
      id: { in: documentIds },
      workspaceId,
      projectId,
      status: "ready",
    },
    select: { id: true },
  });
  if (documents.length !== documentIds.length) {
    throw new GenerationRequestError(
      "Every selected document must be ready and belong to this project",
      400,
    );
  }

  const active = await prisma.generationRun.findFirst({
    where: {
      workspaceId,
      projectId,
      type: "project_plan",
      status: { in: ["processing", "draft"] },
    },
    select: { id: true },
  });
  if (active) {
    throw new GenerationRequestError(
      "Review or reject the active draft plan before generating another one",
      409,
    );
  }

  const startedAt = Date.now();
  let run: { id: string };
  try {
    run = await prisma.generationRun.create({
      data: {
        workspaceId,
        projectId,
        type: "project_plan",
        // Provider/env construction happens after this row exists so even a
        // missing API configuration is retained as an auditable failed run.
        model: deps.chat?.modelName ?? "unavailable",
        promptVersion: PROJECT_PLAN_PROMPT_VERSION,
        selectedContextIds: jsonValue({ documentIds }),
        status: "processing",
        createdBy: userId,
      },
      select: { id: true },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new GenerationRequestError(
        "Review or reject the active draft plan before generating another one",
        409,
      );
    }
    throw error;
  }

  const attempts: string[] = [];
  let selectedContextIds: Prisma.InputJsonValue = jsonValue({ documentIds });

  try {
    const chat = deps.chat ?? getChatProvider();
    const embeddings = deps.embeddings ?? getEmbeddingProvider();
    await prisma.generationRun.update({
      where: { id: run.id },
      data: { model: chat.modelName },
    });

    const chunks = await selectPlanContext(
      workspaceId,
      documentIds,
      embeddings,
    );
    if (chunks.length === 0) {
      throw new PlanValidationError(
        "The selected documents do not contain any indexed text",
      );
    }
    const context = buildLabelledContext(chunks);
    selectedContextIds = jsonValue({
      documentIds,
      sourceLabels: context.sourceLabels,
    });

    const baseMessages = [
      { role: "system" as const, content: PROJECT_PLAN_SYSTEM_PROMPT },
      {
        role: "user" as const,
        content: buildPlanUserMessage(context.contextBlock),
      },
    ];

    attempts.push(
      await chat.complete(baseMessages, {
        jsonMode: true,
        temperature: 0,
        maxTokens: 6000,
      }),
    );
    let parsed = parsePlan(attempts[0]);

    // Exactly one repair attempt. The invalid text is retained verbatim in the
    // audit record and shown back to the provider as assistant output.
    if (!parsed) {
      attempts.push(
        await chat.complete(
          [
            ...baseMessages,
            { role: "assistant" as const, content: attempts[0] },
            {
              role: "user" as const,
              content:
                "That reply did not match the required JSON contract. Correct it and reply with only one valid JSON object. Do not add proposals unless they are cited to a supplied S label.",
            },
          ],
          { jsonMode: true, temperature: 0, maxTokens: 6000 },
        ),
      );
      parsed = parsePlan(attempts[1]);
    }

    if (!parsed) {
      throw new PlanValidationError(
        "The model returned malformed plan data twice",
      );
    }

    const validated = validateProjectPlan(parsed, context.sourceMap);
    const persisted = await persistDraftPlan({
      workspaceId,
      projectId,
      generationRunId: run.id,
      validated,
      rawOutput: rawAttempts(attempts)!,
      selectedContextIds,
      latencyMs: Date.now() - startedAt,
      sourceLabels: context.sourceLabels,
      model: chat.modelName,
    });

    return persisted;
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 2000) : "Generation failed";
    await prisma.generationRun
      .update({
        where: { id: run.id },
        data: {
          status: "failed",
          errorMessage: message,
          latencyMs: Date.now() - startedAt,
          rawOutput: rawAttempts(attempts),
          selectedContextIds,
        },
      })
      .catch(() => undefined);

    if (error instanceof PlanValidationError) {
      throw new GenerationRequestError(error.message, 422);
    }
    throw error;
  }
}

interface PersistDraftInput {
  workspaceId: string;
  projectId: string;
  generationRunId: string;
  validated: ValidatedProjectPlan;
  rawOutput: string;
  selectedContextIds: Prisma.InputJsonValue;
  latencyMs: number;
  sourceLabels: Array<{
    label: string;
    chunkId: string;
    documentId: string;
    filename: string;
    pageNumber: number | null;
    sectionTitle: string | null;
  }>;
  model: string;
}

async function persistDraftPlan(input: PersistDraftInput) {
  const {
    workspaceId,
    projectId,
    generationRunId,
    validated,
    rawOutput,
    selectedContextIds,
    latencyMs,
    sourceLabels,
    model,
  } = input;

  return prisma.$transaction(
    async (tx) => {
      // Plan generation still emits the classic keys (backlog/todo/…). Map them
      // onto this project's columns; unknown keys fall back to the default.
      const projectStatuses = await tx.projectTaskStatus.findMany({
        where: { workspaceId, projectId },
        orderBy: { position: "asc" },
        select: { id: true, key: true, category: true, isDefault: true },
      });
      const statusByKey = new Map(
        projectStatuses.map((status) => [status.key, status]),
      );
      const defaultStatus =
        projectStatuses.find((status) => status.isDefault) ?? projectStatuses[0];
      if (!defaultStatus) {
        throw new Error("This project has no task statuses configured");
      }

      const milestoneIds = new Map<string, string>();
      for (const proposal of validated.milestones) {
        const milestone = await tx.milestone.create({
          data: {
            workspaceId,
            projectId,
            title: proposal.title,
            description: proposal.description,
            targetDate: isoDayToDate(proposal.targetDate),
            status: proposal.status,
            completedAt: proposal.status === "completed" ? new Date() : null,
            source: "ai_suggested",
            generationStatus: "draft",
            generationRunId,
            citations: {
              create: proposal.citations.map((citation) => ({
                workspaceId,
                documentChunkId: citation.chunkId,
                excerpt: citation.excerpt,
              })),
            },
          },
          select: { id: true },
        });
        milestoneIds.set(proposal.ref, milestone.id);
      }

      const taskIds = new Map<string, string>();
      for (const proposal of validated.tasks) {
        const boardStatus =
          statusByKey.get(proposal.status) ?? defaultStatus;
        const task = await tx.task.create({
          data: {
            workspaceId,
            projectId,
            title: proposal.title,
            description: proposal.description,
            statusId: boardStatus.id,
            priority: proposal.priority,
            startDate: isoDayToDate(proposal.startDate),
            dueDate: isoDayToDate(proposal.dueDate),
            completedAt:
              boardStatus.category === "done" ? new Date() : null,
            milestoneId: proposal.milestoneRef
              ? milestoneIds.get(proposal.milestoneRef) ?? null
              : null,
            source: "ai_suggested",
            generationStatus: "draft",
            generationRunId,
            citations: {
              create: [
                ...proposal.citations.map((citation) => ({
                  workspaceId,
                  documentChunkId: citation.chunkId,
                  excerpt: citation.excerpt,
                  purpose: "proposal" as const,
                })),
                ...proposal.milestoneCitations.map((citation) => ({
                  workspaceId,
                  documentChunkId: citation.chunkId,
                  excerpt: citation.excerpt,
                  purpose: "milestone_link" as const,
                })),
              ],
            },
          },
          select: { id: true },
        });
        taskIds.set(proposal.ref, task.id);
      }

      for (const proposal of validated.risks) {
        await tx.projectRisk.create({
          data: {
            workspaceId,
            projectId,
            description: proposal.description,
            impact: proposal.impact,
            likelihood: proposal.likelihood,
            mitigation: proposal.mitigation,
            status: proposal.status,
            milestoneId: proposal.milestoneRef
              ? milestoneIds.get(proposal.milestoneRef) ?? null
              : null,
            source: "ai_suggested",
            generationStatus: "draft",
            generationRunId,
            citations: {
              create: [
                ...proposal.citations.map((citation) => ({
                  workspaceId,
                  documentChunkId: citation.chunkId,
                  excerpt: citation.excerpt,
                  purpose: "proposal" as const,
                })),
                ...proposal.milestoneCitations.map((citation) => ({
                  workspaceId,
                  documentChunkId: citation.chunkId,
                  excerpt: citation.excerpt,
                  purpose: "milestone_link" as const,
                })),
              ],
            },
          },
        });
      }

      for (const proposal of validated.dependencies) {
        const taskId = taskIds.get(proposal.taskRef);
        const dependsOnTaskId = taskIds.get(proposal.dependsOnTaskRef);
        if (!taskId || !dependsOnTaskId) continue;
        await tx.taskDependency.create({
          data: {
            workspaceId,
            taskId,
            dependsOnTaskId,
            source: "ai_suggested",
            generationStatus: "draft",
            generationRunId,
            citations: {
              create: proposal.citations.map((citation) => ({
                workspaceId,
                documentChunkId: citation.chunkId,
                excerpt: citation.excerpt,
              })),
            },
          },
        });
      }

      return tx.generationRun.update({
        where: { id: generationRunId },
        data: {
          status: "draft",
          rawOutput,
          validatedOutput: jsonValue({
            ...validated,
            // Review metadata is safe to expose; the label-to-database-ID map
            // remains exclusively in selectedContextIds on the server.
            sourceLabels: sourceLabels.map(
              ({ label, filename, pageNumber, sectionTitle }) => ({
                label,
                filename,
                pageNumber,
                sectionTitle,
              }),
            ),
          }),
          selectedContextIds,
          latencyMs,
          errorMessage: null,
          model,
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
          latencyMs: true,
          _count: {
            select: {
              tasks: true,
              milestones: true,
              risks: true,
              taskDependencies: true,
            },
          },
        },
      });
    },
    { timeout: 20_000 },
  );
}

const documentCitationSelect = {
  id: true,
  excerpt: true,
  purpose: true,
  chunk: {
    select: {
      id: true,
      pageNumber: true,
      sectionTitle: true,
      document: { select: { id: true, originalFilename: true } },
    },
  },
} as const;

const plainCitationSelect = {
  id: true,
  excerpt: true,
  chunk: {
    select: {
      id: true,
      pageNumber: true,
      sectionTitle: true,
      document: { select: { id: true, originalFilename: true } },
    },
  },
} as const;

const reviewRunSelect = {
  id: true,
  model: true,
  promptVersion: true,
  status: true,
  errorMessage: true,
  latencyMs: true,
  validatedOutput: true,
  createdAt: true,
  approvedAt: true,
  milestones: {
    orderBy: { createdAt: "asc" as const },
    select: {
      id: true,
      title: true,
      description: true,
      targetDate: true,
      status: true,
      generationStatus: true,
      reviewedAt: true,
      citations: { select: plainCitationSelect },
    },
  },
  tasks: {
    orderBy: { createdAt: "asc" as const },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      startDate: true,
      dueDate: true,
      generationStatus: true,
      reviewedAt: true,
      milestone: { select: { id: true, title: true, generationStatus: true } },
      citations: { select: documentCitationSelect },
    },
  },
  risks: {
    orderBy: { createdAt: "asc" as const },
    select: {
      id: true,
      description: true,
      impact: true,
      likelihood: true,
      mitigation: true,
      status: true,
      generationStatus: true,
      reviewedAt: true,
      milestone: { select: { id: true, title: true, generationStatus: true } },
      citations: { select: documentCitationSelect },
    },
  },
  taskDependencies: {
    orderBy: { createdAt: "asc" as const },
    select: {
      id: true,
      taskId: true,
      dependsOnTaskId: true,
      generationStatus: true,
      reviewedAt: true,
      task: { select: { id: true, title: true, generationStatus: true } },
      dependsOnTask: {
        select: { id: true, title: true, generationStatus: true },
      },
      citations: { select: plainCitationSelect },
    },
  },
} as const;

function sanitizeCitedSummary(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (typeof row !== "object" || row === null) return [];
    const record = row as Record<string, unknown>;
    if (typeof record.text !== "string" || !Array.isArray(record.citations)) {
      return [];
    }
    const citations = record.citations.flatMap((citation) => {
      if (typeof citation !== "object" || citation === null) return [];
      const candidate = citation as Record<string, unknown>;
      return typeof candidate.sourceId === "string" &&
        typeof candidate.excerpt === "string"
        ? [{ sourceId: candidate.sourceId, excerpt: candidate.excerpt }]
        : [];
    });
    return [{ text: record.text, citations }];
  });
}

/** Strip all audit-only IDs/raw shape before a generation run crosses to UI. */
export function sanitizeReviewSummary(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const sourceLabels = Array.isArray(record.sourceLabels)
    ? record.sourceLabels.flatMap((source) => {
        if (typeof source !== "object" || source === null) return [];
        const candidate = source as Record<string, unknown>;
        if (
          typeof candidate.label !== "string" ||
          typeof candidate.filename !== "string"
        ) {
          return [];
        }
        return [
          {
            label: candidate.label,
            filename: candidate.filename,
            pageNumber:
              typeof candidate.pageNumber === "number"
                ? candidate.pageNumber
                : null,
            sectionTitle:
              typeof candidate.sectionTitle === "string"
                ? candidate.sectionTitle
                : null,
          },
        ];
      })
    : [];
  return {
    scopeStatements: sanitizeCitedSummary(record.scopeStatements),
    deliverables: sanitizeCitedSummary(record.deliverables),
    acceptanceCriteria: sanitizeCitedSummary(record.acceptanceCriteria),
    warnings: Array.isArray(record.warnings)
      ? record.warnings.filter((warning): warning is string => typeof warning === "string")
      : [],
    sourceLabels,
  };
}

export async function getProjectPlanRuns(workspaceId: string, projectId: string) {
  const runs = await prisma.generationRun.findMany({
    where: { workspaceId, projectId, type: "project_plan" },
    orderBy: { createdAt: "desc" },
    select: reviewRunSelect,
  });
  return runs.map((run) => ({
    ...run,
    validatedOutput: sanitizeReviewSummary(run.validatedOutput),
  }));
}
