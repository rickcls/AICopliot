import "server-only";
import { errorMessageFor } from "@/lib/api";
import type { Prisma } from "@/generated/prisma/client";
import {
  AuthError,
  getUserPreferences,
  type SessionUser,
  type WorkspaceAccess,
} from "@/lib/auth-guard";
import { loadCaptureContext } from "@/lib/capture/context";
import { weekdayOf } from "@/lib/capture/dates";
import { splitCaptureLines } from "@/lib/capture/lines";
import {
  buildCaptureUserMessage,
  CAPTURE_PROMPT_VERSION,
  CAPTURE_SYSTEM_PROMPT,
} from "@/lib/capture/prompt";
import { modelCaptureSchema, type ProposalOverrides } from "@/lib/capture/schemas";
import {
  validateCaptureProposals,
  type AddNotePayload,
  type CreateTaskPayload,
  type UpdateTaskPayload,
} from "@/lib/capture/validate";
import { prisma } from "@/lib/db";
import { extractJsonObject } from "@/lib/generation/prompt";
import { detectReplyLanguage } from "@/lib/language";
import { getOrCreatePersonalProject } from "@/lib/pm/personal-project";
import { officialRecordWhere } from "@/lib/pm/rules";
import { pickStatusForCategory } from "@/lib/pm/status-pick";
import { visibleProjectWhere } from "@/lib/pm/visibility";
import {
  createTaskCommentRecord,
  createTaskRecord,
  findCommentableTask,
  prepareTaskCreate,
  prepareTaskUpdate,
  updateTaskRecord,
} from "@/lib/pm/task-write";
import { getChatProvider, type ChatProvider } from "@/lib/providers";
import { createTaskCommentSchema, createTaskSchema, updateTaskSchema } from "@/lib/schemas";
import { DEFAULT_TIME_ZONE, localDateString, localToday } from "@/lib/time";

/**
 * Capture: a person tells the assistant something, the assistant proposes
 * changes to their tasks, the person applies the ones they want.
 *
 * Captures are private. Every read and write here is scoped by
 * (id, workspaceId, userId) — membership of the workspace is not enough to see
 * a colleague's notes. The body is the person's own record, so it is stored
 * before the model is called and kept if the model fails; Retry runs the model
 * again on the same text and the same day.
 */

export type CaptureAccess = WorkspaceAccess & { user: SessionUser };

export interface CaptureDeps {
  chat?: ChatProvider;
  now?: Date;
}

export class CaptureError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 422,
  ) {
    super(message);
    this.name = "CaptureError";
  }
}

/** A document is read from its cached text; past this, the rest is left out. */
export const MAX_DOCUMENT_CAPTURE_CHARS = 12_000;

const PROPOSAL_SELECT = {
  id: true,
  position: true,
  kind: true,
  state: true,
  payload: true,
  citations: true,
  flags: true,
  taskId: true,
  appliedTaskId: true,
  appliedCommentId: true,
  task: { select: { id: true, title: true, projectId: true, project: { select: { name: true } } } },
  appliedTask: { select: { id: true, projectId: true } },
} as const;

const CAPTURE_SELECT = {
  id: true,
  source: true,
  body: true,
  status: true,
  errorMessage: true,
  localDate: true,
  replyLanguage: true,
  documentId: true,
  document: { select: { originalFilename: true } },
  createdAt: true,
  proposals: { orderBy: { position: "asc" as const }, select: PROPOSAL_SELECT },
} as const;

function scope(access: CaptureAccess) {
  return { workspaceId: access.workspaceId, userId: access.userId };
}

export async function getCapture(access: CaptureAccess, captureId: string) {
  return prisma.capture.findFirst({
    where: { id: captureId, ...scope(access) },
    select: CAPTURE_SELECT,
  });
}

export async function listCaptures(
  access: CaptureAccess,
  {
    before,
    limit = 20,
    pendingOnly = false,
  }: { before?: Date; limit?: number; pendingOnly?: boolean } = {},
) {
  return prisma.capture.findMany({
    where: {
      ...scope(access),
      ...(before ? { createdAt: { lt: before } } : {}),
      // Today shows only notes with something still to decide.
      ...(pendingOnly ? { proposals: { some: { state: "pending" as const } } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 50),
    select: CAPTURE_SELECT,
  });
}

export async function deleteCapture(access: CaptureAccess, captureId: string) {
  const { count } = await prisma.capture.deleteMany({
    where: { id: captureId, ...scope(access) },
  });
  return count > 0;
}

/**
 * Saves what the person said, then asks for proposals. The returned capture is
 * `ready` with proposals, or `failed` with the text intact and an error the
 * page can show beside a Retry button.
 */
export async function createCapture(
  access: CaptureAccess,
  input: { text?: string; documentId?: string; source: "text" | "voice" },
  deps: CaptureDeps = {},
) {
  const now = deps.now ?? new Date();
  const preferences = await getUserPreferences(access.userId);
  const timeZone = preferences?.timeZone ?? DEFAULT_TIME_ZONE;
  const fallbackLanguage = preferences?.locale === "en" ? "en" : "zh-Hant";

  let body = input.text ?? "";
  let documentId: string | null = null;
  if (input.documentId) {
    const document = await prisma.document.findFirst({
      where: { id: input.documentId, workspaceId: access.workspaceId, status: "ready" },
      select: { id: true, extractedText: true },
    });
    if (!document) throw new CaptureError("Document not found or not ready yet", 404);
    if (!document.extractedText?.trim()) {
      throw new CaptureError("This document has no readable text", 422);
    }
    body = document.extractedText.slice(0, MAX_DOCUMENT_CAPTURE_CHARS);
    documentId = document.id;
  }

  const capture = await prisma.capture.create({
    data: {
      ...scope(access),
      source: documentId ? "document" : input.source,
      body,
      documentId,
      localDate: new Date(`${localDateString(timeZone, now)}T00:00:00.000Z`),
      timeZone,
      replyLanguage: detectReplyLanguage(body, fallbackLanguage),
      status: "processing",
    },
    select: { id: true },
  });

  await proposeForCapture(access, capture.id, deps);
  return getCapture(access, capture.id);
}

function parseProposals(raw: string): unknown[] | null {
  try {
    const parsed = modelCaptureSchema.safeParse(JSON.parse(extractJsonObject(raw)));
    return parsed.success ? parsed.data.proposals : null;
  } catch {
    return null;
  }
}

/**
 * One model call (plus at most one repair) for one capture. Never throws for a
 * model failure: the capture is marked `failed` with a message instead, because
 * the person's text is already saved and the page must still show it.
 */
export async function proposeForCapture(
  access: CaptureAccess,
  captureId: string,
  deps: CaptureDeps = {},
) {
  const capture = await prisma.capture.findFirst({
    where: { id: captureId, ...scope(access) },
    select: { id: true, body: true, localDate: true, timeZone: true, replyLanguage: true },
  });
  if (!capture) throw new CaptureError("Capture not found", 404);

  const anchor = capture.localDate.toISOString().slice(0, 10);
  const language = capture.replyLanguage === "en" ? "en" : "zh-Hant";
  const { lines } = splitCaptureLines(capture.body);
  const started = Date.now();

  try {
    const chat = deps.chat ?? getChatProvider();
    const context = await loadCaptureContext(
      access,
      capture.body,
      localToday(capture.timeZone, deps.now ?? new Date()),
    );

    const messages = [
      { role: "system" as const, content: CAPTURE_SYSTEM_PROMPT },
      {
        role: "user" as const,
        content: buildCaptureUserMessage({
          today: anchor,
          weekday: weekdayOf(anchor),
          timeZone: capture.timeZone,
          lines,
          tasks: context.promptTasks,
          projects: context.promptProjects,
          language,
        }),
      },
    ];
    const options = { jsonMode: true, temperature: 0, maxTokens: 3000 };

    let raw = await chat.complete(messages, options);
    let proposals = parseProposals(raw);
    if (!proposals) {
      raw = await chat.complete(
        [
          ...messages,
          { role: "assistant" as const, content: raw },
          {
            role: "user" as const,
            content:
              'That reply did not match the required JSON contract. Reply with only one JSON object of the form {"proposals": [...]}.',
          },
        ],
        options,
      );
      proposals = parseProposals(raw);
    }
    if (!proposals) {
      throw new CaptureError("The model returned malformed proposals twice. Try again.", 422);
    }

    const validated = validateCaptureProposals(proposals, {
      lines,
      tasks: context.taskLabels,
      projects: context.projectLabels,
      anchor,
      language,
    });

    await prisma.$transaction([
      prisma.captureProposal.createMany({
        data: validated.proposals.map((proposal, position) => ({
          ...scope(access),
          captureId: capture.id,
          position,
          kind: proposal.kind,
          payload: proposal.payload as unknown as Prisma.InputJsonValue,
          citations: proposal.citations as unknown as Prisma.InputJsonValue,
          flags: proposal.flags,
          taskId: proposal.taskId,
        })),
      }),
      prisma.capture.update({
        where: { id: capture.id },
        data: {
          status: "ready",
          errorMessage: null,
          modelName: chat.modelName,
          promptVersion: CAPTURE_PROMPT_VERSION,
          rawOutput: raw.slice(0, 20_000),
          latencyMs: Date.now() - started,
        },
      }),
    ]);
  } catch (error) {
    await prisma.capture.update({
      where: { id: capture.id },
      data: {
        status: "failed",
        errorMessage:
          error instanceof CaptureError ? error.message : errorMessageFor(error),
        promptVersion: CAPTURE_PROMPT_VERSION,
        latencyMs: Date.now() - started,
      },
    });
  }
}

/** Runs the model again on the same text. Refused once anything was applied. */
export async function retryCapture(
  access: CaptureAccess,
  captureId: string,
  deps: CaptureDeps = {},
) {
  const capture = await prisma.capture.findFirst({
    where: { id: captureId, ...scope(access) },
    select: { id: true, proposals: { where: { state: "applied" }, select: { id: true } } },
  });
  if (!capture) throw new CaptureError("Capture not found", 404);
  if (capture.proposals.length > 0) {
    throw new CaptureError("Some suggestions were already applied, so this cannot be redone", 409);
  }

  await prisma.$transaction([
    prisma.captureProposal.deleteMany({ where: { captureId: capture.id, ...scope(access) } }),
    prisma.capture.update({
      where: { id: capture.id },
      data: { status: "processing", errorMessage: null },
    }),
  ]);
  await proposeForCapture(access, capture.id, deps);
  return getCapture(access, capture.id);
}

/** Dismisses a pending proposal, or brings a dismissed one back. */
export async function decideProposal(
  access: CaptureAccess,
  proposalId: string,
  state: "dismissed" | "pending",
  now: Date = new Date(),
) {
  const { count } = await prisma.captureProposal.updateMany({
    where: {
      id: proposalId,
      ...scope(access),
      state: state === "dismissed" ? "pending" : "dismissed",
    },
    data: { state, decidedAt: state === "dismissed" ? now : null },
  });
  return count > 0;
}

// --- Apply ------------------------------------------------------------------

export type ApplyResult =
  | { proposalId: string; ok: true; taskId: string | null; commentId: string | null }
  | { proposalId: string; ok: false; status: number; error: string };

/**
 * Claims a pending proposal. Runs inside the transaction that performs the
 * write, so of two concurrent Applies exactly one sees count 1 and writes.
 */
async function claim(
  tx: Prisma.TransactionClient,
  access: CaptureAccess,
  proposalId: string,
  now: Date,
) {
  const { count } = await tx.captureProposal.updateMany({
    where: { id: proposalId, ...scope(access), state: "pending" },
    data: { state: "applied", decidedAt: now },
  });
  if (count === 0) throw new CaptureError("This suggestion was already applied or dismissed", 409);
}

function fail(proposalId: string, status: number, error: string): ApplyResult {
  return { proposalId, ok: false, status, error };
}

/**
 * Applies one proposal as an ordinary manual write — the same `task-write`
 * functions the task routes use — with the person's edits (`overrides`) taking
 * precedence over what the model proposed. New tasks are assigned to the
 * person applying, and land in their personal project unless a project is
 * named.
 */
export async function applyProposal(
  access: CaptureAccess,
  proposalId: string,
  overrides: ProposalOverrides = {},
  now: Date = new Date(),
): Promise<ApplyResult> {
  const proposal = await prisma.captureProposal.findFirst({
    where: { id: proposalId, ...scope(access) },
    select: {
      id: true,
      kind: true,
      state: true,
      payload: true,
      taskId: true,
      capture: { select: { documentId: true, document: { select: { projectId: true } } } },
    },
  });
  if (!proposal) return fail(proposalId, 404, "Suggestion not found");
  if (proposal.state !== "pending") {
    return fail(proposalId, 409, "This suggestion was already applied or dismissed");
  }

  try {
    if (proposal.kind === "create_task") {
      const payload = proposal.payload as unknown as CreateTaskPayload;
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
      if (!project) return fail(proposalId, 404, "Project not found");

      const document = proposal.capture.document;
      const parsed = createTaskSchema.safeParse({
        title: overrides.title ?? payload.title,
        description: overrides.description !== undefined ? overrides.description : payload.description,
        priority: (overrides.priority !== undefined ? overrides.priority : payload.priority) ?? "medium",
        assigneeId: access.userId,
        estimatedHours: payload.estimatedHours,
        dueDate: overrides.dueDate !== undefined ? overrides.dueDate : payload.dueDate,
        // A document capture links its document when the task lands in the
        // same project; a task cannot link a document from another project.
        ...(proposal.capture.documentId && document?.projectId === project.id
          ? { documentIds: [proposal.capture.documentId] }
          : {}),
      });
      if (!parsed.success) {
        return fail(proposalId, 400, parsed.error.issues[0]?.message ?? "Invalid task");
      }

      const prepared = await prepareTaskCreate(access.workspaceId, project.id, parsed.data);
      if (!prepared.ok) return fail(proposalId, prepared.status, prepared.error);

      const task = await prisma.$transaction(async (tx) => {
        await claim(tx, access, proposalId, now);
        const created = await createTaskRecord(tx, prepared.value, access.userId, now);
        await tx.captureProposal.update({
          where: { id: proposalId },
          data: { appliedTaskId: created.id },
        });
        return created;
      });
      return { proposalId, ok: true, taskId: task.id, commentId: null };
    }

    if (!proposal.taskId) return fail(proposalId, 404, "The task no longer exists");

    if (proposal.kind === "add_note") {
      const payload = proposal.payload as unknown as AddNotePayload;
      const parsed = createTaskCommentSchema.safeParse({ body: overrides.note ?? payload.note });
      if (!parsed.success) return fail(proposalId, 400, "Write a note first");
      const task = await findCommentableTask(access.workspaceId, proposal.taskId);
      if (!task) return fail(proposalId, 404, "The task no longer exists");

      const comment = await prisma.$transaction(async (tx) => {
        await claim(tx, access, proposalId, now);
        const created = await createTaskCommentRecord(tx, {
          workspaceId: access.workspaceId,
          taskId: task.id,
          authorId: access.userId,
          body: parsed.data.body,
        });
        await tx.captureProposal.update({
          where: { id: proposalId },
          data: { appliedTaskId: task.id, appliedCommentId: created.id },
        });
        return created;
      });
      return { proposalId, ok: true, taskId: task.id, commentId: comment.id };
    }

    const payload = proposal.payload as unknown as UpdateTaskPayload;
    const status = overrides.status !== undefined ? overrides.status : payload.status;
    const priority = overrides.priority !== undefined ? overrides.priority : payload.priority;
    const dueDate = overrides.dueDate !== undefined ? overrides.dueDate : payload.dueDate;

    const target = await prisma.task.findFirst({
      where: officialRecordWhere({ id: proposal.taskId, workspaceId: access.workspaceId }),
      select: { id: true, projectId: true },
    });
    if (!target) return fail(proposalId, 404, "The task no longer exists");

    let statusId: string | undefined;
    if (status) {
      const statuses = await prisma.projectTaskStatus.findMany({
        where: { workspaceId: access.workspaceId, projectId: target.projectId },
        select: { id: true, key: true, category: true, position: true },
      });
      const picked = pickStatusForCategory(statuses, status);
      if (!picked) {
        return fail(proposalId, 409, `This project has no column for ${status} work`);
      }
      statusId = picked.id;
    }

    const parsed = updateTaskSchema.safeParse({
      ...(statusId ? { statusId } : {}),
      ...(priority ? { priority } : {}),
      ...(dueDate ? { dueDate } : {}),
    });
    if (!parsed.success) return fail(proposalId, 409, "Nothing left to change");

    const prepared = await prepareTaskUpdate(access.workspaceId, target.id, parsed.data);
    if (!prepared.ok) return fail(proposalId, prepared.status, prepared.error);

    await prisma.$transaction(async (tx) => {
      await claim(tx, access, proposalId, now);
      await updateTaskRecord(tx, prepared.value, access.userId);
      await tx.captureProposal.update({
        where: { id: proposalId },
        data: { appliedTaskId: target.id },
      });
    });
    return { proposalId, ok: true, taskId: target.id, commentId: null };
  } catch (error) {
    if (error instanceof CaptureError) return fail(proposalId, error.status, error.message);
    // An assignee or project that no longer resolves in this workspace.
    if (error instanceof AuthError) return fail(proposalId, error.status, error.message);
    throw error;
  }
}

/** Applies several proposals, each on its own: one failure does not undo the rest. */
export async function applyProposals(
  access: CaptureAccess,
  items: { proposalId: string; overrides?: ProposalOverrides }[],
  now: Date = new Date(),
): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];
  for (const item of items) {
    results.push(await applyProposal(access, item.proposalId, item.overrides, now));
  }
  return results;
}

/**
 * What a capture page needs besides the notes: the projects a suggestion can
 * be filed under (the viewer's visible ones) and their personal project, the
 * default home for new tasks.
 */
export async function getCaptureProjectOptions(access: CaptureAccess) {
  const [projects, locale] = await Promise.all([
    prisma.project.findMany({
      where: visibleProjectWhere(access.workspaceId, access.userId),
      orderBy: { name: "asc" },
      select: { id: true, name: true, personalOwnerId: true },
    }),
    getUserPreferences(access.userId).then((preferences) =>
      preferences?.locale === "en" ? ("en" as const) : ("zh-Hant" as const),
    ),
  ]);
  const personal =
    projects.find((project) => project.personalOwnerId === access.userId) ??
    (await getOrCreatePersonalProject(access.workspaceId, access.user, locale));

  return {
    personalProjectId: personal.id,
    projects: [
      { id: personal.id, name: personal.name, personal: true },
      ...projects
        .filter((project) => project.id !== personal.id)
        .map((project) => ({ id: project.id, name: project.name, personal: false })),
    ],
  };
}
