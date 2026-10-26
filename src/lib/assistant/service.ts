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
import { documentName } from "@/lib/documents/name";
import { detectReplyLanguage } from "@/lib/language";
import { tasksMatchingText } from "@/lib/capture/candidates";
import { getMyOpenTasks } from "@/lib/pm/my-work";
import { visibleProjectWhere } from "@/lib/pm/visibility";
import { readChosenDocuments } from "@/lib/rag/chosen-documents";
import {
  getChatProvider,
  getEmbeddingProvider,
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
 * it has); its tools only read, or save a draft; and a task change comes back
 * as a proposal through the capture validator. Sending the message is the
 * person asking for that change, so one with no flag is written in this same
 * turn. A flagged one stays for Apply. Threads are private to their person,
 * like chat threads.
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

/**
 * What a question was pinned to in the composer: one project, and documents
 * attached or chosen to answer from. Kept on the person's message, in the
 * `sources` column an assistant message uses for its labels, so the thread
 * shows it again on reload without a column of its own.
 */
export interface AskContext {
  project: { id: string; name: string } | null;
  documents: { id: string; name: string }[];
}

export interface AssistantMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** The person's message only: what it was asked about. */
  context: AskContext | null;
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

/**
 * The project and documents a question asks about, resolved inside the
 * workspace: a project the person can see, and documents that are indexed.
 * Ids come from the request, so none is trusted until it resolves here.
 */
async function resolveAskContext(
  access: AssistantAccess,
  input: { projectId?: string; documentIds?: string[] },
): Promise<AskContext> {
  const documentIds = input.documentIds ?? [];
  const [project, documents] = await Promise.all([
    input.projectId
      ? prisma.project.findFirst({
          where: { AND: [{ id: input.projectId }, visibleProjectWhere(access.workspaceId, access.userId)] },
          select: { id: true, name: true },
        })
      : null,
    documentIds.length > 0
      ? prisma.document.findMany({
          where: { id: { in: documentIds }, workspaceId: access.workspaceId },
          select: { id: true, originalFilename: true, title: true, status: true },
        })
      : [],
  ]);
  if (input.projectId && !project) throw new AssistantError("Project not found", 404);
  if (documents.length !== documentIds.length) throw new AssistantError("Document not found", 404);
  const notReady = documents.find((document) => document.status !== "ready");
  if (notReady) {
    throw new AssistantError(`${documentName(notReady)} is still being indexed. Ask again in a moment.`, 409);
  }
  const byId = new Map(documents.map((document) => [document.id, document]));
  return {
    project,
    documents: documentIds.flatMap((id) => {
      const document = byId.get(id);
      return document ? [{ id: document.id, name: documentName(document) }] : [];
    }),
  };
}

/** The context a person's stored message carries, if it carries one. */
function readAskContext(stored: unknown): AskContext | null {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
  const value = stored as Partial<AskContext>;
  return Array.isArray(value.documents) ? { project: value.project ?? null, documents: value.documents } : null;
}

function describeInput(input: Record<string, unknown>): string {
  return Object.values(input)
    .filter((value) => typeof value === "string" || typeof value === "number")
    .join(" · ")
    .slice(0, 120);
}

export async function runAssistantTurn(
  access: AssistantAccess,
  input: {
    threadId?: string;
    question: string;
    webSearch?: boolean;
    projectId?: string;
    documentIds?: string[];
  },
  deps: AssistantDeps = {},
): Promise<{ threadId: string; message: AssistantMessageView }> {
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const now = deps.now ?? new Date();

  // Resolved before a new thread exists, so a stale id leaves nothing behind.
  const context = await resolveAskContext(access, input);
  const pinned = context.project !== null || context.documents.length > 0;
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
    data: {
      threadId: thread.id,
      role: "user",
      content: input.question,
      ...(pinned ? { sources: context as unknown as Prisma.InputJsonValue } : {}),
    },
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
  // The chosen project is labelled even when it is not among the recent ones.
  if (context.project && !projects.some((project) => project.id === context.project?.id)) {
    projects.unshift({ ...context.project, personalOwnerId: null });
  }
  const projectLabels = projects.map((project) => {
    const source = registry.add("P", `project:${project.id}`, (label) => ({
      label,
      kind: "project" as const,
      projectId: project.id,
      name: project.name,
    }));
    return {
      id: project.id,
      label: source.label,
      name: project.name,
      personal: project.personalOwnerId === access.userId,
    };
  });

  const allOpenTasks = await getMyOpenTasks(access.workspaceId, access.userId);
  const openTasks = context.project
    ? allOpenTasks.filter((task) => task.project.id === context.project?.id)
    : allOpenTasks;
  // Labelled before the model speaks, so "set the monthly report to urgent"
  // can name T1 in the same answer. A title with no word in common stays out.
  const taskLines = tasksMatchingText(openTasks, input.question, today).map((task) => {
    const due = task.dueDate ? task.dueDate.toISOString().slice(0, 10) : "none";
    const line = `${task.title} | project ${task.project.name} | status ${task.status.category} | column ${task.status.key} | due ${due} | priority ${task.priority}`;
    const source = registry.add("T", `task:${task.id}`, (label) => ({
      label,
      kind: "task" as const,
      taskId: task.id,
      projectId: task.project.id,
      title: task.title,
      category: task.status.category,
      statusKey: task.status.key,
      dueDate: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : null,
      priority: task.priority,
      facts: line,
    }));
    return { label: source.label, line };
  });

  // Attached files are read for the model up front and grouped by file, so a
  // question across them ("what is the difference?") is answered in one step
  // from the whole of each — not from whichever six passages a search returns,
  // which left one file barely seen and passages credited to the wrong one.
  const attachedPassages = context.documents.length
    ? await readChosenDocuments(
        access.workspaceId,
        context.documents.map((document) => document.id),
        deps.embeddings ?? getEmbeddingProvider(),
        input.question,
      ).catch(() => [])
    : [];
  const attached = context.documents.map((document) => ({
    name: document.name,
    passages: attachedPassages
      .filter((passage) => passage.documentId === document.id)
      .map((passage) => {
        const source = registry.add("S", `chunk:${passage.id}`, (label) => ({
          label,
          kind: "document" as const,
          documentId: passage.documentId,
          chunkId: passage.id,
          filename: passage.filename,
          pageNumber: passage.pageNumber,
          content: passage.content,
        }));
        return { label: source.label, pageNumber: passage.pageNumber, content: passage.content };
      }),
  }));

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
        tasks: taskLines,
        scope: {
          project: projectLabels.find((project) => project.id === context.project?.id) ?? null,
          attached,
        },
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
    scope: {
      projectId: context.project?.id ?? null,
      documentIds: context.documents.map((document) => document.id),
    },
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
  const validated = answer ? validateAssistantProposals(answer.proposals, registry, anchor, language) : [];
  // A new task with no project named goes to the one the question is about.
  const proposals = context.project
    ? validated.map((proposal) =>
        proposal.kind === "create_task" && !proposal.payload.projectId
          ? { ...proposal, payload: { ...proposal.payload, projectId: context.project?.id ?? null } }
          : proposal,
      )
    : validated;

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

  if (proposals.length > 0) await carryOutReadyProposals(access, saved.id, now);

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
    context: row.role === "assistant" ? null : readAskContext(row.sources),
    sources: row.role === "assistant" ? (row.sources as unknown as PublicSource[]) : [],
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

/**
 * Sending the message is the person asking for the change, so a proposal the
 * validator accepted with no flag is written before the reply is shown. A
 * flag means the date needs a look, or the new task may repeat an open one,
 * and that one stays on the reply for Apply.
 */
async function carryOutReadyProposals(access: AssistantAccess, messageId: string, now: Date) {
  const rows = await prisma.assistantProposal.findMany({
    where: { messageId, ...scope(access), state: "pending" },
    orderBy: { position: "asc" },
    select: { id: true, flags: true },
  });
  const ready = rows.filter((row) => row.flags.length === 0);
  if (ready.length === 0) return;
  await applyAssistantProposals(
    access,
    messageId,
    ready.map((row) => ({ proposalId: row.id })),
    now,
  );
}

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
