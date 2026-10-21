import "server-only";
import { errorMessageFor } from "@/lib/api";
import type { Prisma } from "@/generated/prisma/client";
import { getUserPreferences, type SessionUser, type WorkspaceAccess } from "@/lib/auth-guard";
import { applyChange } from "@/lib/capture/apply-change";
import { loadCaptureContext } from "@/lib/capture/context";
import { weekdayOf } from "@/lib/capture/dates";
import { splitCaptureLines } from "@/lib/capture/lines";
import {
  buildCaptureUserMessage,
  buildReviseBlock,
  CAPTURE_PROMPT_VERSION,
  CAPTURE_SYSTEM_PROMPT,
  clarificationLine,
  MAX_REVISED_PROPOSALS,
  type CaptureLinesSource,
  type ReviseTarget,
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
import { STALE_RUN_MESSAGE, STALE_RUN_MS } from "@/lib/generation/stale-runs";
import { detectReplyLanguage } from "@/lib/language";
import { getOrCreatePersonalProject } from "@/lib/pm/personal-project";
import { getAssignableMembers } from "@/lib/pm/project";
import { storeDocument } from "@/lib/documents/store";
import { visibleProjectWhere } from "@/lib/pm/visibility";
import { getChatProvider, type ChatProvider } from "@/lib/providers";
import type { ChatMessageInput } from "@/lib/providers/types";
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
  // A note still processing this long after its last write lost its request
  // (see STALE_RUN_MS). Failing it brings back its Retry button; `updatedAt`,
  // not `createdAt`, because a retry reuses the row.
  await prisma.capture.updateMany({
    where: {
      ...scope(access),
      status: "processing",
      updatedAt: { lt: new Date(Date.now() - STALE_RUN_MS) },
    },
    data: { status: "failed", errorMessage: STALE_RUN_MESSAGE },
  });
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
  input: {
    text?: string;
    documentId?: string;
    source: "text" | "voice" | "email" | "whatsapp";
    /** An email's id, so it is captured once per person (`@@unique([userId, externalId])`). */
    externalId?: string;
  },
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
      externalId: input.externalId ?? null,
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

/** Whose words the lines are, as the prompt describes them. */
function promptSource(source: string): CaptureLinesSource {
  return source === "email" || source === "whatsapp" ? source : "note";
}

/** One model call, plus one repair when the reply breaks the JSON contract. */
async function askForProposals(chat: ChatProvider, messages: ChatMessageInput[]) {
  const options = { jsonMode: true, temperature: 0, maxTokens: 3000, reasoning: false };
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
  return { raw, proposals };
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
    select: { id: true, body: true, localDate: true, timeZone: true, replyLanguage: true, source: true },
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
          source: promptSource(capture.source),
        }),
      },
    ];
    const { raw, proposals } = await askForProposals(chat, messages);

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

/** The changes an update proposes, in words the model can read. */
function describeUpdate(payload: UpdateTaskPayload): string {
  return [
    payload.status ? `status ${payload.status}` : null,
    payload.priority ? `priority ${payload.priority}` : null,
    payload.dueDate ? `due ${payload.dueDate}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * Redoes one pending suggestion from the person's correction ("this is a new
 * task, not the monthly report").
 *
 * The correction is the person's own words, so it is added to the end of the
 * note before the model is called and kept whatever happens — like any note.
 * Adding to the end leaves every earlier C label where it was. The replacements
 * go through the same validator as any capture, and the old suggestion is
 * claimed (`pending` → deleted) in the same transaction that writes them, so a
 * suggestion applied meanwhile is never silently replaced.
 */
export async function reviseProposal(
  access: CaptureAccess,
  proposalId: string,
  instruction: string,
  deps: CaptureDeps = {},
) {
  const proposal = await prisma.captureProposal.findFirst({
    where: { id: proposalId, ...scope(access) },
    select: {
      id: true,
      kind: true,
      state: true,
      payload: true,
      citations: true,
      position: true,
      taskId: true,
      task: { select: { title: true } },
      capture: {
        select: { id: true, body: true, localDate: true, timeZone: true, replyLanguage: true, source: true },
      },
    },
  });
  if (!proposal) throw new CaptureError("Suggestion not found", 404);
  if (proposal.state !== "pending") {
    throw new CaptureError("This suggestion was already applied or dismissed", 409);
  }

  const capture = proposal.capture;
  const language = detectReplyLanguage(instruction, capture.replyLanguage === "en" ? "en" : "zh-Hant");
  const appended = `\n\n${clarificationLine(instruction, language)}`;
  // A note already at the line limit would lose the correction off its end.
  if (splitCaptureLines(capture.body + appended).truncated) {
    throw new CaptureError("This note is too long to add a correction to", 422);
  }

  // Appended in SQL, so two corrections sent at once both survive.
  const [stored] = await prisma.$queryRaw<{ body: string }[]>`
    UPDATE "Capture" SET "body" = "body" || ${appended}, "updatedAt" = now()
    WHERE "id" = ${capture.id} AND "workspaceId" = ${access.workspaceId} AND "userId" = ${access.userId}
    RETURNING "body"`;
  if (!stored) throw new CaptureError("Capture not found", 404);
  const body = stored.body;
  const before = splitCaptureLines(body.slice(0, -appended.length)).lines.length;
  const { lines } = splitCaptureLines(body);

  const anchor = capture.localDate.toISOString().slice(0, 10);
  const captureLanguage = capture.replyLanguage === "en" ? "en" : "zh-Hant";
  const chat = deps.chat ?? getChatProvider();
  const context = await loadCaptureContext(
    access,
    body,
    localToday(capture.timeZone, deps.now ?? new Date()),
  );

  const others = await prisma.captureProposal.findMany({
    where: { captureId: capture.id, ...scope(access), state: "pending", NOT: { id: proposal.id } },
    orderBy: { position: "asc" },
    select: { kind: true, payload: true, task: { select: { title: true } } },
  });
  const pendingTitles = others
    .filter((other) => other.kind === "create_task")
    .map((other) => (other.payload as unknown as CreateTaskPayload).title);
  const otherSuggestions = others.map((other) =>
    other.kind === "create_task"
      ? `new task "${(other.payload as unknown as CreateTaskPayload).title}"`
      : `${other.kind === "update_task" ? "update" : "note on"} "${other.task?.title ?? ""}"`,
  );

  const citedLabels = (proposal.citations as unknown as { label: string }[]).map((cited) => cited.label);
  const taskLabel =
    [...context.taskLabels].find(([, task]) => task.id === proposal.taskId)?.[0] ?? null;
  const target: ReviseTarget = {
    kind: proposal.kind,
    summary:
      proposal.kind === "create_task"
        ? (proposal.payload as unknown as CreateTaskPayload).title
        : proposal.kind === "add_note"
          ? (proposal.payload as unknown as AddNotePayload).note
          : describeUpdate(proposal.payload as unknown as UpdateTaskPayload),
    taskLabel,
    taskTitle: proposal.task?.title ?? null,
    citedLabels,
  };

  const messages: ChatMessageInput[] = [
    { role: "system", content: CAPTURE_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        buildCaptureUserMessage({
          today: anchor,
          weekday: weekdayOf(anchor),
          timeZone: capture.timeZone,
          lines,
          tasks: context.promptTasks,
          projects: context.promptProjects,
          language: captureLanguage,
          source: promptSource(capture.source),
        }),
        "",
        buildReviseBlock(
          target,
          lines.slice(before).map((line) => line.label),
          otherSuggestions,
        ),
      ].join("\n"),
    },
  ];

  const { proposals } = await askForProposals(chat, messages);
  const validated = validateCaptureProposals(proposals, {
    lines,
    tasks: context.taskLabels,
    projects: context.projectLabels,
    anchor,
    language: captureLanguage,
    pendingTitles,
  }).proposals.slice(0, MAX_REVISED_PROPOSALS);
  if (validated.length === 0) {
    throw new CaptureError("Could not redo the suggestion from that. Say a little more about what you mean.", 422);
  }

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.captureProposal.deleteMany({
      where: { id: proposal.id, ...scope(access), state: "pending" },
    });
    if (claimed.count === 0) {
      throw new CaptureError("This suggestion was already applied or dismissed", 409);
    }
    // Make room so the replacements sit where the old suggestion was.
    if (validated.length > 1) {
      await tx.captureProposal.updateMany({
        where: { captureId: capture.id, ...scope(access), position: { gt: proposal.position } },
        data: { position: { increment: validated.length - 1 } },
      });
    }
    await tx.captureProposal.createMany({
      data: validated.map((replacement, index) => ({
        ...scope(access),
        captureId: capture.id,
        position: proposal.position + index,
        kind: replacement.kind,
        payload: replacement.payload as unknown as Prisma.InputJsonValue,
        citations: replacement.citations as unknown as Prisma.InputJsonValue,
        flags: replacement.flags,
        taskId: replacement.taskId,
      })),
    });
  });
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

function fail(proposalId: string, status: number, error: string): ApplyResult {
  return { proposalId, ok: false, status, error };
}

/**
 * Applies one capture proposal through the shared `applyChange`, with the
 * person's edits (`overrides`) taking precedence over what the model proposed.
 * The claim is a conditional update of this capture proposal, inside the
 * write's transaction.
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
      capture: { select: { documentId: true } },
    },
  });
  if (!proposal) return fail(proposalId, 404, "Suggestion not found");
  if (proposal.state !== "pending") {
    return fail(proposalId, 409, "This suggestion was already applied or dismissed");
  }

  const result = await applyChange(
    access,
    {
      kind: proposal.kind,
      payload: proposal.payload,
      taskId: proposal.taskId,
      document: proposal.capture.documentId ? { id: proposal.capture.documentId } : null,
    },
    overrides,
    {
      claim: async (tx) => {
        const { count } = await tx.captureProposal.updateMany({
          where: { id: proposalId, ...scope(access), state: "pending" },
          data: { state: "applied", decidedAt: now },
        });
        return count === 1;
      },
      record: async (tx, applied) => {
        await tx.captureProposal.update({
          where: { id: proposalId },
          data: { appliedTaskId: applied.taskId, appliedCommentId: applied.commentId },
        });
      },
    },
    now,
  );
  return result.ok
    ? { proposalId, ok: true, taskId: result.taskId, commentId: result.commentId }
    : { proposalId, ...result };
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
 * be filed under (the viewer's visible ones), their personal project, the
 * default home for new tasks, and the colleagues a new task can be handed to.
 */
export async function getCaptureProjectOptions(access: CaptureAccess) {
  const [projects, locale, members] = await Promise.all([
    prisma.project.findMany({
      where: visibleProjectWhere(access.workspaceId, access.userId),
      orderBy: { name: "asc" },
      select: { id: true, name: true, personalOwnerId: true },
    }),
    getUserPreferences(access.userId).then((preferences) =>
      preferences?.locale === "en" ? ("en" as const) : ("zh-Hant" as const),
    ),
    getAssignableMembers(access.workspaceId),
  ]);
  const personal =
    projects.find((project) => project.personalOwnerId === access.userId) ??
    (await getOrCreatePersonalProject(access.workspaceId, access.user, locale));

  return {
    personalProjectId: personal.id,
    /**
     * Who else a new task can be handed to. The person applying is the
     * default, so they are not listed; a solo workspace gets an empty list
     * and no picker.
     */
    colleagues: members
      .filter((member) => member.id !== access.userId)
      .map((member) => ({ id: member.id, name: member.name })),
    projects: [
      { id: personal.id, name: personal.name, personal: true },
      ...projects
        .filter((project) => project.id !== personal.id)
        .map((project) => ({ id: project.id, name: project.name, personal: false })),
    ],
  };
}

/**
 * Keeps a note as an ordinary document in the person's personal project, so it
 * is searchable and can ground answers. This is the one deliberate way a
 * private capture becomes workspace-visible — the person is told so before
 * they confirm — and it goes through `storeDocument`, the same validated path
 * as an upload. The capture remembers the document, so it is saved once.
 */
export async function saveCaptureAsDocument(access: CaptureAccess, captureId: string) {
  const capture = await prisma.capture.findFirst({
    where: { id: captureId, ...scope(access) },
    select: { id: true, body: true, source: true, documentId: true, localDate: true },
  });
  if (!capture) throw new CaptureError("Capture not found", 404);
  if (capture.documentId) {
    throw new CaptureError("This note already has a document", 409);
  }

  const personal = await getOrCreatePersonalProject(
    access.workspaceId,
    access.user,
    (await getUserPreferences(access.userId))?.locale === "en" ? "en" : "zh-Hant",
  );
  const day = capture.localDate.toISOString().slice(0, 10);
  const stored = await storeDocument({
    workspaceId: access.workspaceId,
    projectId: personal.id,
    filename: `note-${day}.md`,
    mimeType: "text/markdown",
    buffer: Buffer.from(`# ${day}\n\n${capture.body}\n`, "utf8"),
  });
  if (!stored.ok) throw new CaptureError(stored.error, 422);

  await prisma.capture.updateMany({
    where: { id: capture.id, ...scope(access), documentId: null },
    data: { documentId: stored.id },
  });
  return { documentId: stored.id };
}
