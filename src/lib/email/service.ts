import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { getUserPreferences, type WorkspaceAccess } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { findUnsupportedFacts, type FactFlag } from "@/lib/email/facts";
import {
  buildEmailDraftMessage,
  buildStyleProfileMessage,
  EMAIL_DRAFT_SYSTEM_PROMPT,
  MAX_EXAMPLES_IN_PROMPT,
  modelEmailDraftSchema,
  modelStyleProfileSchema,
  STYLE_PROFILE_SYSTEM_PROMPT,
  type EmailPurpose,
} from "@/lib/email/prompt";
import { extractJsonObject } from "@/lib/generation/prompt";
import { toTraditional } from "@/lib/language-convert";
import { detectReplyLanguage, type ReplyLanguage } from "@/lib/language";
import { officialRecordWhere } from "@/lib/pm/rules";
import { getWritingProvider, type ChatProvider } from "@/lib/providers";

export class EmailError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 422,
  ) {
    super(message);
    this.name = "EmailError";
  }
}

export interface WritingStyleView {
  samples: string[];
  profile: string | null;
  signature: string | null;
}

export interface EmailDraftView {
  id: string;
  purpose: string;
  recipient: string | null;
  subject: string;
  body: string;
  flags: FactFlag[];
  language: string;
  taskId: string | null;
  createdAt: string;
}

function toDraftView(row: {
  id: string;
  purpose: string;
  recipient: string | null;
  subject: string;
  body: string;
  flags: unknown;
  language: string;
  taskId: string | null;
  createdAt: Date;
}): EmailDraftView {
  return { ...row, flags: row.flags as FactFlag[], createdAt: row.createdAt.toISOString() };
}

async function fallbackLanguage(userId: string): Promise<ReplyLanguage> {
  return (await getUserPreferences(userId))?.locale === "en" ? "en" : "zh-Hant";
}

async function completeJson<T>(
  chat: ChatProvider,
  system: string,
  user: string,
  parse: (raw: string) => T | null,
  maxTokens: number,
): Promise<T | null> {
  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
  const options = { jsonMode: true, temperature: 0.3, maxTokens };
  const first = await chat.complete(messages, options);
  const parsed = parse(first);
  if (parsed) return parsed;
  const second = await chat.complete(
    [
      ...messages,
      { role: "assistant" as const, content: first },
      { role: "user" as const, content: "Reply with only the one JSON object described." },
    ],
    options,
  );
  return parse(second);
}

function parseWith<T>(schema: { safeParse: (value: unknown) => { success: boolean; data?: T } }) {
  return (raw: string): T | null => {
    try {
      const parsed = schema.safeParse(JSON.parse(extractJsonObject(raw)));
      return parsed.success ? (parsed.data as T) : null;
    } catch {
      return null;
    }
  };
}

// --- Writing style ------------------------------------------------------------

/** Per person, not per workspace: the same voice follows them everywhere. */
export async function getWritingStyle(userId: string): Promise<WritingStyleView> {
  const style = await prisma.writingStyle.findUnique({ where: { userId } });
  return {
    samples: (style?.samples as string[] | undefined) ?? [],
    profile: style?.profile ?? null,
    signature: style?.signature ?? null,
  };
}

export async function saveWritingStyle(
  userId: string,
  input: { samples?: string[]; profile?: string | null; signature?: string | null },
): Promise<WritingStyleView> {
  const data = {
    ...(input.samples !== undefined ? { samples: input.samples as Prisma.InputJsonValue } : {}),
    ...(input.profile !== undefined ? { profile: input.profile || null } : {}),
    ...(input.signature !== undefined ? { signature: input.signature || null } : {}),
  };
  await prisma.writingStyle.upsert({
    where: { userId },
    create: { userId, samples: [], ...data },
    update: data,
  });
  return getWritingStyle(userId);
}

/** Describes the person's tone from their samples. The result is theirs to edit. */
export async function deriveStyleProfile(
  userId: string,
  deps: { chat?: ChatProvider } = {},
): Promise<WritingStyleView> {
  const style = await getWritingStyle(userId);
  if (style.samples.length < 2) {
    throw new EmailError("Add at least two of your own emails first.", 422);
  }
  const language = await fallbackLanguage(userId);
  const result = await completeJson(
    deps.chat ?? getWritingProvider(),
    STYLE_PROFILE_SYSTEM_PROMPT,
    buildStyleProfileMessage(style.samples, language),
    parseWith(modelStyleProfileSchema),
    1200,
  );
  if (!result) throw new EmailError("The model returned a malformed description twice. Try again.", 422);
  const profile = language === "zh-Hant" ? toTraditional(result.profile) : result.profile;
  return saveWritingStyle(userId, { profile });
}

// --- Drafts -------------------------------------------------------------------

export interface DraftInput {
  purpose: EmailPurpose;
  recipient?: string;
  keyPoints: string;
  incoming?: string;
  taskId?: string;
  language: "auto" | ReplyLanguage;
}

/**
 * Drafts one email in the person's voice and keeps it. Facts may come only
 * from what the person gave — key points, the email being answered, the
 * task's own record — and `findUnsupportedFacts` flags anything else in the
 * draft for them to check. Their example emails shape the tone and are not a
 * source of facts, so they are left out of that check on purpose.
 */
export async function draftEmail(
  access: WorkspaceAccess,
  input: DraftInput,
  deps: { chat?: ChatProvider } = {},
): Promise<EmailDraftView> {
  const style = await getWritingStyle(access.userId);

  let taskFacts: string | null = null;
  if (input.taskId) {
    const task = await prisma.task.findFirst({
      where: officialRecordWhere({ id: input.taskId, workspaceId: access.workspaceId }),
      select: {
        title: true,
        description: true,
        dueDate: true,
        project: { select: { name: true } },
        status: { select: { label: true, category: true } },
        comments: {
          orderBy: { createdAt: "desc" },
          take: 3,
          select: { body: true, createdAt: true },
        },
      },
    });
    if (!task) throw new EmailError("Task not found", 404);
    taskFacts = [
      `title: ${task.title}`,
      `project: ${task.project.name}`,
      `status: ${task.status.label} (${task.status.category})`,
      `due: ${task.dueDate ? task.dueDate.toISOString().slice(0, 10) : "none"}`,
      task.description ? `description: ${task.description}` : null,
      ...task.comments.map(
        (comment) => `note ${comment.createdAt.toISOString().slice(0, 10)}: ${comment.body}`,
      ),
    ]
      .filter(Boolean)
      .join("\n");
  }

  const fallback = await fallbackLanguage(access.userId);
  const language: ReplyLanguage =
    input.language === "auto"
      ? detectReplyLanguage(input.incoming || input.keyPoints, fallback)
      : input.language;
  const examples = style.samples
    .filter((sample) => detectReplyLanguage(sample, language) === language)
    .slice(-MAX_EXAMPLES_IN_PROMPT);

  const chat = deps.chat ?? getWritingProvider();
  const result = await completeJson(
    chat,
    EMAIL_DRAFT_SYSTEM_PROMPT,
    buildEmailDraftMessage({
      purpose: input.purpose,
      recipient: input.recipient ?? null,
      keyPoints: input.keyPoints,
      incoming: input.incoming ?? null,
      taskFacts,
      profile: style.profile,
      examples,
      signature: style.signature,
      language,
    }),
    parseWith(modelEmailDraftSchema),
    3000,
  );
  if (!result) throw new EmailError("The model returned a malformed draft twice. Try again.", 422);

  const prose = (text: string) => (language === "zh-Hant" ? toTraditional(text) : text);
  const subject = prose(result.subject);
  const body = prose(result.body);
  const flags = findUnsupportedFacts(`${subject}\n${body}`, [
    input.keyPoints,
    input.incoming,
    input.recipient,
    taskFacts,
    style.signature,
  ]);

  const row = await prisma.emailDraft.create({
    data: {
      workspaceId: access.workspaceId,
      userId: access.userId,
      taskId: input.taskId ?? null,
      purpose: input.purpose,
      recipient: input.recipient || null,
      subject,
      body,
      flags: flags as unknown as Prisma.InputJsonValue,
      language,
      modelName: chat.modelName,
    },
  });
  return toDraftView(row);
}

export async function listEmailDrafts(access: WorkspaceAccess, limit = 10) {
  const rows = await prisma.emailDraft.findMany({
    where: { workspaceId: access.workspaceId, userId: access.userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(toDraftView);
}

export async function deleteEmailDraft(access: WorkspaceAccess, id: string) {
  const { count } = await prisma.emailDraft.deleteMany({
    where: { id, workspaceId: access.workspaceId, userId: access.userId },
  });
  return count > 0;
}

/** One of the caller's own drafts, for reopening it from the assistant. */
export async function getEmailDraft(access: WorkspaceAccess, id: string) {
  const row = await prisma.emailDraft.findFirst({
    where: { id, workspaceId: access.workspaceId, userId: access.userId },
  });
  return row ? toDraftView(row) : null;
}
