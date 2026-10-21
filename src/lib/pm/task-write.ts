import "server-only";
import type { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { TaskStatusCategory } from "@/generated/prisma/enums";
import { requireWorkspaceMember } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { findOfficialProjectMilestone } from "@/lib/pm/project";
import {
  completedAtOnCreate,
  completedAtOnStatusChange,
  DONE_TASK_CATEGORY,
  officialRecordWhere,
} from "@/lib/pm/rules";
import { taskSelect } from "@/lib/pm/select";
import {
  resolveTaskRelations,
  type ResolvedTaskRelations,
} from "@/lib/pm/task-relations";
import type {
  createTaskCommentSchema,
  createTaskSchema,
  updateTaskSchema,
} from "@/lib/schemas";

/**
 * The one write path for manual tasks and comments.
 *
 * The task routes and Capture's Apply both go through these functions, so a
 * task a person applies from a capture is validated and written exactly like
 * one they typed into the form — same status resolution, same date-order rule,
 * same completion timestamp, same relation checks. That is what lets a capture
 * proposal be "a manual write the user approved" rather than a second kind of
 * record (invariant 11 keeps AI drafts for generated plans only).
 *
 * Each write is split in two: `prepare*` does the reads and validation outside
 * any transaction, and `*Record` does the writes with whatever client it is
 * given — `prisma` from a route, or a transaction from Apply, which must claim
 * its proposal in the same transaction as the write.
 */

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type CreateCommentInput = z.infer<typeof createTaskCommentSchema>;

type Db = Prisma.TransactionClient | typeof prisma;

export type WriteCheck<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 404; error: string };

function refuse(status: 400 | 404, error: string): WriteCheck<never> {
  return { ok: false, status, error };
}

export const COMMENT_SELECT = {
  id: true,
  body: true,
  createdAt: true,
  author: { select: { id: true, name: true, email: true } },
} as const;

/** The requested column, else the project's default, else its first. */
export async function resolveProjectStatus(
  workspaceId: string,
  projectId: string,
  statusId: string | undefined,
) {
  if (statusId) {
    return prisma.projectTaskStatus.findFirst({
      where: { id: statusId, workspaceId, projectId },
      select: { id: true, category: true },
    });
  }

  const fallback = await prisma.projectTaskStatus.findFirst({
    where: { workspaceId, projectId, isDefault: true },
    select: { id: true, category: true },
  });
  if (fallback) return fallback;

  return prisma.projectTaskStatus.findFirst({
    where: { workspaceId, projectId },
    orderBy: { position: "asc" },
    select: { id: true, category: true },
  });
}

// --- Create -----------------------------------------------------------------

export interface PreparedTaskCreate {
  workspaceId: string;
  projectId: string;
  input: CreateTaskInput;
  status: { id: string; category: TaskStatusCategory };
  relations: ResolvedTaskRelations;
}

/**
 * Validates a new task inside an already-authorised project. An assignee from
 * outside the workspace throws `AuthError` (404), as `requireWorkspaceMember`
 * always has. `carriedDocumentIds` is for a server-side caller only — the
 * document a capture was made from, which may be filed in another project.
 */
export async function prepareTaskCreate(
  workspaceId: string,
  projectId: string,
  input: CreateTaskInput,
  carriedDocumentIds: readonly string[] = [],
): Promise<WriteCheck<PreparedTaskCreate>> {
  if (input.assigneeId) {
    await requireWorkspaceMember(workspaceId, input.assigneeId);
  }
  if (input.milestoneId) {
    const milestone = await findOfficialProjectMilestone(
      workspaceId,
      projectId,
      input.milestoneId,
    );
    if (!milestone) return refuse(404, "Milestone not found in this project");
  }

  const status = await resolveProjectStatus(workspaceId, projectId, input.statusId);
  if (!status) return refuse(404, "Status not found in this project");

  const relations = await resolveTaskRelations(
    workspaceId,
    projectId,
    input,
    carriedDocumentIds,
  );
  if (!relations.ok) return refuse(404, relations.error);

  return {
    ok: true,
    value: { workspaceId, projectId, input, status, relations: relations.value },
  };
}

/** One nested write, so a task never exists without the links it was created with. */
export async function createTaskRecord(
  db: Db,
  prepared: PreparedTaskCreate,
  userId: string,
  now: Date = new Date(),
) {
  const { workspaceId, projectId, input, status } = prepared;
  const { documentIds = [], citations, requirementIds } = prepared.relations;

  return db.task.create({
    data: {
      workspaceId,
      projectId,
      title: input.title,
      description: input.description ?? null,
      statusId: status.id,
      priority: input.priority,
      assigneeId: input.assigneeId ?? null,
      milestoneId: input.milestoneId ?? null,
      estimatedHours: input.estimatedHours ?? null,
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      completedAt: completedAtOnCreate(status.category, DONE_TASK_CATEGORY, now),
      documents: {
        create: documentIds.map((documentId) => ({ workspaceId, documentId })),
      },
      citations: {
        create: citations.map((citation) => ({
          workspaceId,
          documentChunkId: citation.documentChunkId,
          excerpt: citation.excerpt,
          purpose: "proposal" as const,
        })),
      },
      requirementLinks: {
        create: requirementIds.map((requirementId) => ({
          workspaceId,
          requirementId,
          targetType: "task" as const,
          createdById: userId,
        })),
      },
    },
    select: taskSelect,
  });
}

// --- Update -----------------------------------------------------------------

export interface PreparedTaskUpdate {
  workspaceId: string;
  taskId: string;
  data: UpdateTaskInput;
  relations: ResolvedTaskRelations;
  completedAt: Date | null | undefined;
}

/**
 * Validates a change to an official task. Fields left `undefined` are left
 * alone; the date-order rule is checked against the stored row so a PATCH that
 * moves only one date cannot pass the other.
 */
export async function prepareTaskUpdate(
  workspaceId: string,
  taskId: string,
  data: UpdateTaskInput,
): Promise<WriteCheck<PreparedTaskUpdate>> {
  const existing = await prisma.task.findFirst({
    where: officialRecordWhere({ id: taskId, workspaceId }),
    select: {
      id: true,
      projectId: true,
      statusId: true,
      status: { select: { category: true } },
      startDate: true,
      dueDate: true,
    },
  });
  if (!existing) return refuse(404, "Task not found");

  if (data.assigneeId) {
    await requireWorkspaceMember(workspaceId, data.assigneeId);
  }
  if (data.milestoneId) {
    const milestone = await findOfficialProjectMilestone(
      workspaceId,
      existing.projectId,
      data.milestoneId,
    );
    if (!milestone) return refuse(404, "Milestone not found in this project");
  }

  const nextStart = data.startDate !== undefined ? data.startDate : existing.startDate;
  const nextDue = data.dueDate !== undefined ? data.dueDate : existing.dueDate;
  if (nextStart && nextDue && nextStart.getTime() > nextDue.getTime()) {
    return refuse(400, "Start date must be on or before the due date");
  }

  let nextCategory = existing.status.category;
  if (data.statusId !== undefined && data.statusId !== existing.statusId) {
    const status = await prisma.projectTaskStatus.findFirst({
      where: { id: data.statusId, workspaceId, projectId: existing.projectId },
      select: { id: true, category: true },
    });
    if (!status) return refuse(404, "Status not found in this project");
    nextCategory = status.category;
  }

  // A link the task already has stays valid where its document lives, so a
  // task moved from another project can still be saved with its documents.
  const touchesDocuments =
    data.documentIds !== undefined || (data.citations?.length ?? 0) > 0;
  const carried = touchesDocuments
    ? (
        await prisma.taskDocument.findMany({
          where: { workspaceId, taskId: existing.id },
          select: { documentId: true },
        })
      ).map((link) => link.documentId)
    : [];
  const relations = await resolveTaskRelations(
    workspaceId,
    existing.projectId,
    data,
    carried,
  );
  if (!relations.ok) return refuse(404, relations.error);

  const completedAt = completedAtOnStatusChange(
    existing.status.category,
    data.statusId !== undefined ? nextCategory : undefined,
    DONE_TASK_CATEGORY,
  );

  return {
    ok: true,
    value: {
      workspaceId,
      taskId: existing.id,
      data,
      relations: relations.value,
      completedAt,
    },
  };
}

/** Must run inside a transaction: the link writes and the update are one change. */
export async function updateTaskRecord(
  tx: Prisma.TransactionClient,
  prepared: PreparedTaskUpdate,
  userId: string,
) {
  const { workspaceId, taskId, data, completedAt } = prepared;
  const { documentIds, citations, requirementIds } = prepared.relations;

  // Documents are a set the form states in full; citations and requirement
  // links only accumulate here — each has its own place to be removed.
  if (documentIds !== undefined) {
    await tx.taskDocument.deleteMany({
      where: { taskId, documentId: { notIn: documentIds } },
    });
    await tx.taskDocument.createMany({
      data: documentIds.map((documentId) => ({ workspaceId, taskId, documentId })),
      skipDuplicates: true,
    });
  }
  if (citations.length > 0) {
    await tx.taskCitation.createMany({
      data: citations.map((citation) => ({
        workspaceId,
        taskId,
        documentChunkId: citation.documentChunkId,
        excerpt: citation.excerpt,
        purpose: "proposal" as const,
      })),
      skipDuplicates: true,
    });
  }
  if (requirementIds.length > 0) {
    await tx.requirementLink.createMany({
      data: requirementIds.map((requirementId) => ({
        workspaceId,
        requirementId,
        targetType: "task" as const,
        taskId,
        createdById: userId,
      })),
      skipDuplicates: true,
    });
  }

  return tx.task.update({
    where: { id: taskId },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.statusId !== undefined ? { statusId: data.statusId } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...(data.assigneeId !== undefined ? { assigneeId: data.assigneeId } : {}),
      ...(data.milestoneId !== undefined ? { milestoneId: data.milestoneId } : {}),
      ...(data.estimatedHours !== undefined
        ? { estimatedHours: data.estimatedHours }
        : {}),
      ...(data.startDate !== undefined ? { startDate: data.startDate } : {}),
      ...(data.dueDate !== undefined ? { dueDate: data.dueDate } : {}),
      ...(completedAt !== undefined ? { completedAt } : {}),
    },
    select: taskSelect,
  });
}

// --- Comments ---------------------------------------------------------------

/**
 * Resolves a task for discussion. Not limited to official records: a draft
 * task awaiting review is exactly what reviewers need to discuss.
 */
export async function findCommentableTask(workspaceId: string, taskId: string) {
  return prisma.task.findFirst({
    where: { id: taskId, workspaceId },
    select: { id: true },
  });
}

/**
 * The author is always the session user passed in by the caller, never a value
 * from a request body — otherwise a caller could post in somebody else's name.
 */
export async function createTaskCommentRecord(
  db: Db,
  {
    workspaceId,
    taskId,
    authorId,
    body,
  }: { workspaceId: string; taskId: string; authorId: string; body: string },
) {
  return db.taskComment.create({
    data: { workspaceId, taskId, authorId, body },
    select: COMMENT_SELECT,
  });
}
