import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { AuthError, getUserPreferences, type SessionUser, type WorkspaceAccess } from "@/lib/auth-guard";
import type { ProposalOverrides } from "@/lib/capture/schemas";
import type {
  AddNotePayload,
  CreateTaskPayload,
  ProposalStatus,
  UpdateTaskPayload,
} from "@/lib/capture/validate";
import { prisma } from "@/lib/db";
import { getOrCreatePersonalProject } from "@/lib/pm/personal-project";
import { officialRecordWhere } from "@/lib/pm/rules";
import { pickStatusForCategory } from "@/lib/pm/status-pick";
import {
  createTaskCommentRecord,
  createTaskRecord,
  findCommentableTask,
  prepareTaskCreate,
  prepareTaskUpdate,
  updateTaskRecord,
} from "@/lib/pm/task-write";
import { createTaskCommentSchema, createTaskSchema, updateTaskSchema } from "@/lib/schemas";

/**
 * Applying one proposed change — create a task, update one, or add a progress
 * note — as an ordinary manual write through `task-write.ts`.
 *
 * Shared by every source of proposals (a capture, the assistant), which differ
 * only in where the proposal is stored. Each passes `claim`, a conditional
 * update of its own proposal row (pending → applied), and `record`, which
 * notes what was written; both run inside the same transaction as the write,
 * so of two concurrent Applies exactly one writes.
 */

export interface ProposedChange {
  kind: "create_task" | "update_task" | "add_note";
  payload: unknown;
  taskId: string | null;
  /** A document to link when a created task lands in that document's project. */
  document: { id: string; projectId: string | null } | null;
}

export interface ClaimHooks {
  claim(tx: Prisma.TransactionClient): Promise<boolean>;
  record(tx: Prisma.TransactionClient, applied: { taskId: string; commentId: string | null }): Promise<void>;
}

export type ChangeResult =
  | { ok: true; taskId: string; commentId: string | null }
  | { ok: false; status: number; error: string };

class LostClaim extends Error {}

const ALREADY_DECIDED = "This suggestion was already applied or dismissed";

function refuse(status: number, error: string): ChangeResult {
  return { ok: false, status, error };
}

/** The project's column for a proposed status, or a refusal when it has none. */
async function columnForStatus(
  workspaceId: string,
  projectId: string,
  status: ProposalStatus | null | undefined,
): Promise<{ ok: true; statusId?: string } | { ok: false; error: string }> {
  if (!status) return { ok: true };
  const statuses = await prisma.projectTaskStatus.findMany({
    where: { workspaceId, projectId },
    select: { id: true, key: true, category: true, position: true },
  });
  const picked = pickStatusForCategory(statuses, status);
  if (!picked) return { ok: false, error: `This project has no column for ${status} work` };
  return { ok: true, statusId: picked.id };
}

async function inTransaction<T>(
  hooks: ClaimHooks,
  write: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    if (!(await hooks.claim(tx))) throw new LostClaim();
    return write(tx);
  });
}

export async function applyChange(
  access: WorkspaceAccess & { user: SessionUser },
  change: ProposedChange,
  overrides: ProposalOverrides,
  hooks: ClaimHooks,
  now: Date = new Date(),
): Promise<ChangeResult> {
  try {
    if (change.kind === "create_task") {
      const payload = change.payload as CreateTaskPayload;
      const projectId = overrides.projectId ?? payload.projectId;
      const project = projectId
        ? await prisma.project.findFirst({
            where: { id: projectId, workspaceId: access.workspaceId },
            select: { id: true },
          })
        : await getOrCreatePersonalProject(
            access.workspaceId,
            access.user,
            (await getUserPreferences(access.userId))?.locale === "en" ? "en" : "zh-Hant",
          );
      if (!project) return refuse(404, "Project not found");

      const status = overrides.status !== undefined ? overrides.status : payload.status;
      const column = await columnForStatus(access.workspaceId, project.id, status);
      if (!column.ok) return refuse(409, column.error);

      const parsed = createTaskSchema.safeParse({
        title: overrides.title ?? payload.title,
        description: overrides.description !== undefined ? overrides.description : payload.description,
        priority: (overrides.priority !== undefined ? overrides.priority : payload.priority) ?? "medium",
        // `prepareTaskCreate` refuses an assignee outside the workspace.
        assigneeId: overrides.assigneeId ?? access.userId,
        estimatedHours: payload.estimatedHours,
        dueDate: overrides.dueDate !== undefined ? overrides.dueDate : payload.dueDate,
        ...(column.statusId ? { statusId: column.statusId } : {}),
        // A task can only link a document in its own project.
        ...(change.document && change.document.projectId === project.id
          ? { documentIds: [change.document.id] }
          : {}),
      });
      if (!parsed.success) return refuse(400, parsed.error.issues[0]?.message ?? "Invalid task");

      const prepared = await prepareTaskCreate(access.workspaceId, project.id, parsed.data);
      if (!prepared.ok) return refuse(prepared.status, prepared.error);

      const task = await inTransaction(hooks, async (tx) => {
        const created = await createTaskRecord(tx, prepared.value, access.userId, now);
        await hooks.record(tx, { taskId: created.id, commentId: null });
        return created;
      });
      return { ok: true, taskId: task.id, commentId: null };
    }

    if (!change.taskId) return refuse(404, "The task no longer exists");

    if (change.kind === "add_note") {
      const payload = change.payload as AddNotePayload;
      const parsed = createTaskCommentSchema.safeParse({ body: overrides.note ?? payload.note });
      if (!parsed.success) return refuse(400, "Write a note first");
      const task = await findCommentableTask(access.workspaceId, change.taskId);
      if (!task) return refuse(404, "The task no longer exists");

      const comment = await inTransaction(hooks, async (tx) => {
        const created = await createTaskCommentRecord(tx, {
          workspaceId: access.workspaceId,
          taskId: task.id,
          authorId: access.userId,
          body: parsed.data.body,
        });
        await hooks.record(tx, { taskId: task.id, commentId: created.id });
        return created;
      });
      return { ok: true, taskId: task.id, commentId: comment.id };
    }

    const payload = change.payload as UpdateTaskPayload;
    const status = overrides.status !== undefined ? overrides.status : payload.status;
    const priority = overrides.priority !== undefined ? overrides.priority : payload.priority;
    const dueDate = overrides.dueDate !== undefined ? overrides.dueDate : payload.dueDate;

    const target = await prisma.task.findFirst({
      where: officialRecordWhere({ id: change.taskId, workspaceId: access.workspaceId }),
      select: { id: true, projectId: true },
    });
    if (!target) return refuse(404, "The task no longer exists");

    const column = await columnForStatus(access.workspaceId, target.projectId, status);
    if (!column.ok) return refuse(409, column.error);

    const parsed = updateTaskSchema.safeParse({
      ...(column.statusId ? { statusId: column.statusId } : {}),
      ...(priority ? { priority } : {}),
      ...(dueDate ? { dueDate } : {}),
    });
    if (!parsed.success) return refuse(409, "Nothing left to change");

    const prepared = await prepareTaskUpdate(access.workspaceId, target.id, parsed.data);
    if (!prepared.ok) return refuse(prepared.status, prepared.error);

    await inTransaction(hooks, async (tx) => {
      await updateTaskRecord(tx, prepared.value, access.userId);
      await hooks.record(tx, { taskId: target.id, commentId: null });
    });
    return { ok: true, taskId: target.id, commentId: null };
  } catch (error) {
    if (error instanceof LostClaim) return refuse(409, ALREADY_DECIDED);
    // An assignee or project that no longer resolves in this workspace.
    if (error instanceof AuthError) return refuse(error.status, error.message);
    throw error;
  }
}
