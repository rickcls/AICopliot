import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { getUserPreferences, type SessionUser, type WorkspaceAccess } from "@/lib/auth-guard";
import {
  assistantSystemPrompt,
  buildOpeningMessage,
  finalizeAnswer,
  foundSoFar,
  MAX_TOOL_STEPS,
  parseStep,
  SourceRegistry,
  stripLabels,
  toPublicSources,
  toolsForTurn,
  validateAssistantProposals,
  type PublicSource,
} from "@/lib/assistant/protocol";
import { runTool } from "@/lib/assistant/tools";
import { applyChange } from "@/lib/capture/apply-change";
import type { ProposalOverrides } from "@/lib/capture/schemas";
import type { CaptureProposalView } from "@/lib/capture/view";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import type { EmailDraftView } from "@/lib/email/service";
import type { FactFlag } from "@/lib/email/facts";
import { detectReplyLanguage } from "@/lib/language";
import { visibleProjectWhere } from "@/lib/pm/visibility";
import {
  getChatProvider,
  isProviderTimeout,
  type ChatProvider,
  type EmbeddingProvider,
} from "@/lib/providers";
import { DEFAULT_TIME_ZONE, localToday } from "@/lib/time";

/**
 * One turn of the assistant: a bounded tool loop inside a single request.
 *
 * The loop is the only place in the app where a model chooses its next step,
 * and it is fenced in three ways: it ends after `MAX_TOOL_STEPS` tools or
 * `DEADLINE_MS`, whichever comes first (then the model must answer with what
 * it has); its tools only read, or save a draft; and anything it would change
 * comes back as a proposal through the capture validator and the shared write
 * path, applied only when the person clicks. Threads are private to their
 * person, like chat threads.
 */

export type AssistantAccess = WorkspaceAccess & { user: SessionUser };

export interface AssistantDeps {
  chat?: ChatProvider;
  writer?: ChatProvider;
  embeddings?: EmbeddingProvider;
  now?: Date;
  /** Injected in tests; the wall clock in production. */
  clock?: () => number;
}

const DEADLINE_MS = 40_000;
/**
 * No model call may run past this, whatever the deadline above has allowed:
 * the turn must still be saved inside the request's 60 seconds. A call that
 * would not fit is skipped, and one that runs out of time ends the loop with
 * what the tools found rather than failing the turn.
 */
const BUDGET_MS = 52_000;
const MIN_CALL_MS = 5_000;
const HISTORY_TURNS = 6;
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export class AssistantError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409,
  ) {
    super(message);
    this.name = "AssistantError";
  }
}

export interface AssistantStep {
  tool: string;
  input: string;
  summary: string;
}

export interface AssistantMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: PublicSource[];
  steps: AssistantStep[];
  general: boolean;
  drafts: EmailDraftView[];
  proposals: CaptureProposalView[];
  createdAt: string;
}

function scope(access: WorkspaceAccess) {
  return { workspaceId: access.workspaceId, userId: access.userId };
}

function describeInput(input: Record<string, unknown>): string {
  return Object.values(input)
    .filter((value) => typeof value === "string" || typeof value === "number")
    .join(" · ")
    .slice(0, 120);
}

export async function runAssistantTurn(
  access: AssistantAccess,
  input: { threadId?: string; question: string; webSearch?: boolean },
  deps: AssistantDeps = {},
): Promise<{ threadId: string; message: AssistantMessageView }> {
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const now = deps.now ?? new Date();

  const thread = input.threadId
    ? await prisma.assistantThread.findFirst({ where: { id: input.threadId, ...scope(access) } })
    : await prisma.assistantThread.create({
        data: { ...scope(access), title: input.question.replace(/\s+/g, " ").slice(0, 80) },
      });
  if (!thread) throw new AssistantError("Conversation not found", 404);

  const earlier = await prisma.assistantMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: "desc" },
    take: HISTORY_TURNS,
    select: { role: true, content: true },
  });
  await prisma.assistantMessage.create({
    data: { threadId: thread.id, role: "user", content: input.question },
  });

  const preferences = await getUserPreferences(access.userId);
  const timeZone = preferences?.timeZone ?? DEFAULT_TIME_ZONE;
  const today = localToday(timeZone, now);
  const language = detectReplyLanguage(input.question, preferences?.locale === "en" ? "en" : "zh-Hant");

  const registry = new SourceRegistry();
  registry.add("U", "question", (label) => ({ label, kind: "question" as const, content: input.question }));
  const projects = await prisma.project.findMany({
    where: visibleProjectWhere(access.workspaceId, access.userId),
    orderBy: { updatedAt: "desc" },
    take: 40,
    select: { id: true, name: true, personalOwnerId: true },
  });
  const projectLabels = projects.map((project) => {
    const source = registry.add("P", `project:${project.id}`, (label) => ({
      label,
      kind: "project" as const,
      projectId: project.id,
      name: project.name,
    }));
    return { label: source.label, name: project.name, personal: project.personalOwnerId === access.userId };
  });

  const chat = deps.chat ?? getChatProvider();
  const anchor = today.toISOString().slice(0, 10);
  // The switch only counts when a key exists. Without one the turn runs as usual.
  const webSearch = input.webSearch === true && Boolean(getEnv().TAVILY_API_KEY);
  const allowedTools = toolsForTurn(webSearch);
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: assistantSystemPrompt(webSearch) },
    {
      role: "user",
      content: buildOpeningMessage({
        today: anchor,
        weekday: WEEKDAYS[(today.getUTCDay() + 6) % 7],
        timeZone,
        language,
        projects: projectLabels,
        history: earlier.reverse().map((turn) => ({
          role: turn.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: stripLabels(turn.content).slice(0, 800),
        })),
        question: input.question,
      }),
    },
  ];
  // No thinking: each step is a small JSON choice, and six thinking steps
  // pushed a turn past its deadline and into the fallback answer.
  const options = { jsonMode: true, temperature: 0, maxTokens: 2500, reasoning: false };
  const ask = async (): Promise<string | null> => {
    const left = BUDGET_MS - (clock() - started);
    if (left < MIN_CALL_MS) return null;
    try {
      return await chat.complete(messages, { ...options, timeoutMs: left });
    } catch (error) {
      if (isProviderTimeout(error)) return null;
      throw error;
    }
  };
  const toolContext = {
    access,
    registry,
    today,
    draftIds: [] as string[],
    embeddings: deps.embeddings,
    writer: deps.writer,
  };
  const steps: AssistantStep[] = [];

  let answer: { answer: string; citations: string[]; general: boolean; proposals: unknown[] } | null = null;
  let malformed = 0;
  // Tool steps plus one last call that must answer.
  for (let turn = 0; turn <= MAX_TOOL_STEPS && !answer; turn++) {
    const mustAnswer = turn === MAX_TOOL_STEPS || clock() - started > DEADLINE_MS;
    if (mustAnswer) {
      messages.push({
        role: "user",
        content: 'No more tools. Answer now with {"action":"answer",...} using what you have found.',
      });
    }
    const raw = await ask();
    if (raw === null) break;
    const step = parseStep(raw, allowedTools);
    messages.push({ role: "assistant", content: raw });

    if (!step) {
      malformed += 1;
      if (malformed >= 2) break;
      messages.push({ role: "user", content: "That was not one valid JSON object of the required shape. Reply with exactly one." });
      continue;
    }
    if (step.kind === "answer") {
      answer = step;
      break;
    }
    if (mustAnswer) break;
    if (step.kind === "unknown_tool") {
      messages.push({ role: "user", content: `RESULT: there is no tool called "${step.action}". Use one of the listed tools or answer.` });
      continue;
    }
    const outcome = await runTool(step.tool, step.input, toolContext);
    steps.push({ tool: step.tool, input: describeInput(step.input), summary: outcome.summary });
    messages.push({ role: "user", content: `RESULT (${step.tool}):\n${outcome.text}` });
  }

  // Told to answer, the model sometimes asks for one more tool or breaks the
  // format. One last call that may only answer, before giving up on it.
  if (!answer) {
    messages.push({
      role: "user",
      content: 'Answer now. Reply with exactly one {"action":"answer","answer":"…","citations":[…]} object built from the results above. Do not call any tool.',
    });
    const raw = await ask();
    const step = raw === null ? null : parseStep(raw, allowedTools);
    if (step?.kind === "answer") answer = step;
  }

  const final = answer
    ? finalizeAnswer(answer.answer, answer.citations, answer.general, registry, language)
    : finalizeAnswer(foundSoFar(registry, language), [], false, registry, language);
  const proposals = answer ? validateAssistantProposals(answer.proposals, registry, anchor, language) : [];

  const saved = await prisma.$transaction(async (tx) => {
    const message = await tx.assistantMessage.create({
      data: {
        threadId: thread.id,
        role: "assistant",
        content: final.content,
        sources: toPublicSources(registry, final.used) as unknown as Prisma.InputJsonValue,
        steps: steps as unknown as Prisma.InputJsonValue,
        general: final.general,
        draftIds: toolContext.draftIds,
        modelName: chat.modelName,
        latencyMs: clock() - started,
      },
    });
    if (proposals.length > 0) {
      await tx.assistantProposal.createMany({
        data: proposals.map((proposal, position) => ({
          ...scope(access),
          messageId: message.id,
          position,
          kind: proposal.kind,
          payload: proposal.payload as unknown as Prisma.InputJsonValue,
          citations: proposal.citations as unknown as Prisma.InputJsonValue,
          flags: proposal.flags,
          taskId: proposal.taskId,
        })),
      });
    }
    await tx.assistantThread.update({ where: { id: thread.id }, data: { lastMessageAt: new Date() } });
    return message;
  });

  const [view] = await loadMessages(access, thread.id, [saved.id]);
  return { threadId: thread.id, message: view };
}

// --- Reading threads ------------------------------------------------------------

export async function listThreads(access: WorkspaceAccess, limit = 30) {
  return prisma.assistantThread.findMany({
    where: scope(access),
    orderBy: { lastMessageAt: "desc" },
    take: limit,
    select: { id: true, title: true, lastMessageAt: true },
  });
}

export async function getThread(access: WorkspaceAccess, threadId: string) {
  const thread = await prisma.assistantThread.findFirst({
    where: { id: threadId, ...scope(access) },
    select: { id: true, title: true },
  });
  if (!thread) return null;
  return { ...thread, messages: await loadMessages(access, thread.id) };
}

export async function deleteThread(access: WorkspaceAccess, threadId: string) {
  const { count } = await prisma.assistantThread.deleteMany({ where: { id: threadId, ...scope(access) } });
  return count > 0;
}

async function loadMessages(access: WorkspaceAccess, threadId: string, ids?: string[]): Promise<AssistantMessageView[]> {
  const rows = await prisma.assistantMessage.findMany({
    where: { threadId, ...(ids ? { id: { in: ids } } : {}), thread: scope(access) },
    orderBy: { createdAt: "asc" },
    include: {
      proposals: {
        orderBy: { position: "asc" },
        include: {
          task: { select: { id: true, title: true, projectId: true, project: { select: { name: true } } } },
          appliedTask: { select: { projectId: true } },
        },
      },
    },
  });
  const draftIds = rows.flatMap((row) => row.draftIds);
  const drafts = draftIds.length
    ? await prisma.emailDraft.findMany({ where: { id: { in: draftIds }, ...scope(access) } })
    : [];
  const draftById = new Map(drafts.map((draft) => [draft.id, draft]));

  return rows.map((row) => ({
    id: row.id,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    sources: row.sources as unknown as PublicSource[],
    steps: row.steps as unknown as AssistantStep[],
    general: row.general,
    drafts: row.draftIds.flatMap((id) => {
      const draft = draftById.get(id);
      return draft
        ? [
            {
              id: draft.id,
              purpose: draft.purpose,
              recipient: draft.recipient,
              subject: draft.subject,
              body: draft.body,
              flags: draft.flags as unknown as FactFlag[],
              language: draft.language,
              taskId: draft.taskId,
              createdAt: draft.createdAt.toISOString(),
            },
          ]
        : [];
    }),
    proposals: row.proposals.map(
      (proposal) =>
        ({
          id: proposal.id,
          kind: proposal.kind,
          state: proposal.state,
          payload: proposal.payload,
          citations: proposal.citations,
          flags: proposal.flags,
          task: proposal.task
            ? {
                id: proposal.task.id,
                title: proposal.task.title,
                projectId: proposal.task.projectId,
                projectName: proposal.task.project.name,
              }
            : null,
          appliedTaskId: proposal.appliedTaskId,
          appliedCommentId: proposal.appliedCommentId,
          appliedTaskProjectId: proposal.appliedTask?.projectId ?? null,
        }) as unknown as CaptureProposalView,
    ),
    createdAt: row.createdAt.toISOString(),
  }));
}

// --- Applying what it proposed --------------------------------------------------

export type AssistantApplyResult =
  | { proposalId: string; ok: true; taskId: string; commentId: string | null }
  | { proposalId: string; ok: false; status: number; error: string };

export async function applyAssistantProposals(
  access: AssistantAccess,
  messageId: string,
  items: { proposalId: string; overrides?: ProposalOverrides }[],
  now: Date = new Date(),
): Promise<AssistantApplyResult[]> {
  const results: AssistantApplyResult[] = [];
  for (const item of items) {
    const proposal = await prisma.assistantProposal.findFirst({
      where: { id: item.proposalId, messageId, ...scope(access) },
      select: { id: true, kind: true, state: true, payload: true, taskId: true },
    });
    if (!proposal) {
      results.push({ proposalId: item.proposalId, ok: false, status: 404, error: "Suggestion not found" });
      continue;
    }
    if (proposal.state !== "pending") {
      results.push({ proposalId: proposal.id, ok: false, status: 409, error: "This suggestion was already applied or dismissed" });
      continue;
    }
    const result = await applyChange(
      access,
      { kind: proposal.kind, payload: proposal.payload, taskId: proposal.taskId, document: null },
      item.overrides ?? {},
      {
        claim: async (tx) => {
          const { count } = await tx.assistantProposal.updateMany({
            where: { id: proposal.id, ...scope(access), state: "pending" },
            data: { state: "applied", decidedAt: now },
          });
          return count === 1;
        },
        record: async (tx, applied) => {
          await tx.assistantProposal.update({
            where: { id: proposal.id },
            data: { appliedTaskId: applied.taskId, appliedCommentId: applied.commentId },
          });
        },
      },
      now,
    );
    results.push({ proposalId: proposal.id, ...result });
  }
  return results;
}

export async function decideAssistantProposal(
  access: WorkspaceAccess,
  proposalId: string,
  state: "dismissed" | "pending",
  now: Date = new Date(),
) {
  const { count } = await prisma.assistantProposal.updateMany({
    where: { id: proposalId, ...scope(access), state: state === "dismissed" ? "pending" : "dismissed" },
    data: { state, decidedAt: state === "dismissed" ? now : null },
  });
  return count > 0;
}

export async function getMessageView(access: WorkspaceAccess, messageId: string) {
  const message = await prisma.assistantMessage.findFirst({
    where: { id: messageId, thread: scope(access) },
    select: { id: true, threadId: true },
  });
  if (!message) return null;
  const [view] = await loadMessages(access, message.threadId, [message.id]);
  return view ?? null;
}
