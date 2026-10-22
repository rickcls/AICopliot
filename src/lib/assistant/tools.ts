import "server-only";
import { z } from "zod";
import type { SessionUser, WorkspaceAccess } from "@/lib/auth-guard";
import { snippetAround } from "@/lib/documents/snippet";
import { prisma } from "@/lib/db";
import { draftEmail } from "@/lib/email/service";
import { getEnv } from "@/lib/env";
import { activityOf, getMyOpenTasks, type MyOpenTask } from "@/lib/pm/my-work";
import { daysSinceActivity, isStale, officialRecordWhere } from "@/lib/pm/rules";
import { bucketMyTasks, rankTasks } from "@/lib/pm/today";
import { getEmbeddingProvider, type ChatProvider, type EmbeddingProvider } from "@/lib/providers";
import { hasGroundingEvidence } from "@/lib/rag/ranking";
import { retrieveChunks } from "@/lib/rag/retrieve";
import { SourceRegistry, TASK_FILTERS, type ToolName } from "@/lib/assistant/protocol";
import { tasksMatchingText } from "@/lib/capture/candidates";

/**
 * The assistant's tools. Every one reads inside the caller's workspace — and
 * for notes, only the caller's own — and labels what it returns through the
 * run's registry. The only one that writes is `draft_email`, and what it
 * writes is a private draft the person may or may not send themselves.
 * `search_web` is the exception: one read-only Tavily request, offered only
 * on a turn whose composer switch is on.
 */

export interface ToolContext {
  access: WorkspaceAccess & { user: SessionUser };
  registry: SourceRegistry;
  today: Date;
  draftIds: string[];
  embeddings?: EmbeddingProvider;
  writer?: ChatProvider;
}

export interface ToolOutcome {
  /** What the model reads. */
  text: string;
  /** What the person sees in the step trace. */
  summary: string;
}

const PASSAGE_CHARS = 700;
const WEB_RESULTS = 5;
const WEB_SNIPPET_CHARS = 400;
const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

const inputs = {
  search_documents: z.object({
    query: z.string().trim().min(1).max(300),
    project: z.string().trim().max(12).optional(),
  }),
  list_my_tasks: z.object({ filter: z.enum(TASK_FILTERS).catch("open") }),
  find_tasks: z.object({ query: z.string().trim().min(1).max(200) }),
  get_task: z.object({ task: z.string().trim().min(1).max(12) }),
  search_notes: z.object({ query: z.string().trim().min(1).max(200) }),
  draft_email: z.object({
    purpose: z.enum(["reply", "follow_up", "update", "request", "thanks", "other"]).catch("other"),
    key_points: z.string().trim().min(1).max(2000),
    recipient: z.string().trim().max(200).optional(),
    task: z.string().trim().max(12).optional(),
  }),
  search_web: z.object({
    query: z.string().trim().min(1).max(300),
  }),
} satisfies Record<ToolName, z.ZodType>;

function taskFacts(task: MyOpenTask, today: Date): string {
  const due = task.dueDate ? task.dueDate.toISOString().slice(0, 10) : "none";
  const quiet = daysSinceActivity(activityOf(task), today);
  return `${task.title} | project ${task.project.name} | status ${task.status.category} | column ${task.status.key} | due ${due} | priority ${task.priority} | no update for ${quiet} days`;
}

function registerTask(ctx: ToolContext, task: MyOpenTask) {
  return ctx.registry.add("T", `task:${task.id}`, (label) => ({
    label,
    kind: "task" as const,
    taskId: task.id,
    projectId: task.project.id,
    title: task.title,
    category: task.status.category,
    statusKey: task.status.key,
    dueDate: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : null,
    priority: task.priority,
    facts: taskFacts(task, ctx.today),
  }));
}

async function searchDocuments(ctx: ToolContext, input: z.infer<typeof inputs.search_documents>): Promise<ToolOutcome> {
  const project = input.project ? ctx.registry.get(input.project) : undefined;
  const projectId = project?.kind === "project" ? project.projectId : null;
  const { workspaceId } = ctx.access;

  let chunks: { id: string; documentId: string; filename: string; content: string; pageNumber: number | null }[] = [];
  try {
    const embeddings = ctx.embeddings ?? getEmbeddingProvider();
    const [vector] = await embeddings.embed([input.query]);
    const retrieved = await retrieveChunks(workspaceId, vector, input.query, 6, projectId);
    const minScore = getEnv().RAG_MIN_SCORE;
    chunks = retrieved.filter((chunk) => hasGroundingEvidence(chunk, minScore));
  } catch {
    // Without embeddings, fall back to a literal match so the tool still works.
    const literal = await prisma.documentChunk.findMany({
      where: {
        workspaceId,
        content: { contains: input.query, mode: "insensitive" },
        document: { workspaceId, status: "ready", ...(projectId ? { projectId } : {}) },
      },
      take: 6,
      select: { id: true, documentId: true, content: true, pageNumber: true, document: { select: { originalFilename: true } } },
    });
    chunks = literal.map((chunk) => ({ ...chunk, filename: chunk.document.originalFilename }));
  }

  if (chunks.length === 0) return { text: "No passages found.", summary: "0" };
  const blocks = chunks.map((chunk) => {
    const source = ctx.registry.add("S", `chunk:${chunk.id}`, (label) => ({
      label,
      kind: "document" as const,
      documentId: chunk.documentId,
      chunkId: chunk.id,
      filename: chunk.filename,
      pageNumber: chunk.pageNumber,
      content: chunk.content,
    }));
    const where = [`file: ${chunk.filename}`, chunk.pageNumber !== null ? `page ${chunk.pageNumber}` : null].filter(Boolean).join(", ");
    return `[${source.label}] (${where})\n${chunk.content.slice(0, PASSAGE_CHARS)}`;
  });
  return { text: blocks.join("\n\n"), summary: String(chunks.length) };
}

async function listMyTasks(ctx: ToolContext, input: z.infer<typeof inputs.list_my_tasks>): Promise<ToolOutcome> {
  const tasks = await getMyOpenTasks(ctx.access.workspaceId, ctx.access.userId);
  const buckets = bucketMyTasks(tasks, ctx.today);
  const chosen = {
    overdue: buckets.overdue,
    today: buckets.dueToday,
    week: [...buckets.dueToday, ...buckets.dueSoon],
    blocked: tasks.filter((task) => task.status.category === "blocked"),
    quiet: tasks.filter((task) => isStale(activityOf(task), ctx.today)),
    open: rankTasks(tasks, ctx.today),
  }[input.filter].slice(0, 30);

  if (chosen.length === 0) return { text: "No tasks match.", summary: "0" };
  const lines = chosen.map((task) => `${registerTask(ctx, task).label}: ${taskFacts(task, ctx.today)}`);
  return { text: lines.join("\n"), summary: String(chosen.length) };
}

async function findTasks(ctx: ToolContext, input: z.infer<typeof inputs.find_tasks>): Promise<ToolOutcome> {
  const tasks = await getMyOpenTasks(ctx.access.workspaceId, ctx.access.userId);
  const matched = tasksMatchingText(tasks, input.query, ctx.today, 8);
  if (matched.length === 0) {
    return {
      text: "No open task title shares those words. Do not invent a T label. Create a task if they asked for a new one.",
      summary: "0",
    };
  }
  const lines = matched.map((task) => `${registerTask(ctx, task).label}: ${taskFacts(task, ctx.today)}`);
  return { text: lines.join("\n"), summary: String(matched.length) };
}

async function getTask(ctx: ToolContext, input: z.infer<typeof inputs.get_task>): Promise<ToolOutcome> {
  const source = ctx.registry.get(input.task);
  if (source?.kind !== "task") return { text: `Unknown task label ${input.task}. Find or list tasks first.`, summary: "unknown" };
  const task = await prisma.task.findFirst({
    where: officialRecordWhere({ id: source.taskId, workspaceId: ctx.access.workspaceId }),
    select: {
      description: true,
      comments: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { body: true, createdAt: true, author: { select: { name: true, email: true } } },
      },
      documents: { select: { document: { select: { originalFilename: true, title: true } } } },
    },
  });
  if (!task) return { text: "That task no longer exists.", summary: "gone" };

  return {
    text: [
      `${source.label}: ${source.facts}`,
      `description: ${task.description ?? "(none)"}`,
      task.comments.length
        ? `recent notes:\n${task.comments
            .map((comment) => `- ${comment.createdAt.toISOString().slice(0, 10)} ${comment.author?.name ?? comment.author?.email ?? "someone"}: ${comment.body.slice(0, 400)}`)
            .join("\n")}`
        : "recent notes: (none)",
      task.documents.length
        ? `linked documents: ${task.documents.map((link) => link.document.title ?? link.document.originalFilename).join("; ")}`
        : "linked documents: (none)",
    ].join("\n"),
    summary: source.title,
  };
}

async function searchNotes(ctx: ToolContext, input: z.infer<typeof inputs.search_notes>): Promise<ToolOutcome> {
  const notes = await prisma.capture.findMany({
    where: {
      workspaceId: ctx.access.workspaceId,
      userId: ctx.access.userId,
      body: { contains: input.query, mode: "insensitive" },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, body: true, localDate: true },
  });
  if (notes.length === 0) return { text: "No notes mention that.", summary: "0" };
  const blocks = notes.map((note) => {
    const source = ctx.registry.add("N", `note:${note.id}`, (label) => ({
      label,
      kind: "note" as const,
      captureId: note.id,
      content: note.body,
    }));
    return `[${source.label}] (${note.localDate.toISOString().slice(0, 10)}) ${snippetAround(note.body, input.query, 200).text}`;
  });
  return { text: blocks.join("\n"), summary: String(notes.length) };
}

async function writeDraft(ctx: ToolContext, input: z.infer<typeof inputs.draft_email>): Promise<ToolOutcome> {
  const task = input.task ? ctx.registry.get(input.task) : undefined;
  const draft = await draftEmail(
    ctx.access,
    {
      purpose: input.purpose,
      keyPoints: input.key_points,
      recipient: input.recipient,
      taskId: task?.kind === "task" ? task.taskId : undefined,
      language: "auto",
    },
    ctx.writer ? { chat: ctx.writer } : {},
  );
  ctx.draftIds.push(draft.id);
  const source = ctx.registry.add("D", `draft:${draft.id}`, (label) => ({
    label,
    kind: "draft" as const,
    draftId: draft.id,
    subject: draft.subject,
  }));
  return {
    text: [
      `[${source.label}] Draft saved for the person to review. Not sent.`,
      `Subject: ${draft.subject}`,
      draft.body.slice(0, 600),
      draft.flags.length ? `Facts to check: ${draft.flags.map((flag) => flag.text).join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    summary: draft.subject,
  };
}

/** An https URL only. `javascript:` and other schemes never become a W label. */
function httpsPage(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function searchSnippet(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, WEB_SNIPPET_CHARS);
}

/**
 * One Tavily search. The page itself is never fetched — the model sees the
 * title, the https URL, and a short snippet, each labelled W. Tavily's own
 * answer and raw page text stay off, so the assistant still writes the reply.
 */
async function searchWeb(ctx: ToolContext, input: { query: string }): Promise<ToolOutcome> {
  const key = getEnv().TAVILY_API_KEY;
  if (!key) return { text: "Web search is not available.", summary: "unavailable" };

  let payload: unknown;
  try {
    const response = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        query: input.query,
        max_results: WEB_RESULTS,
        search_depth: "basic",
        include_answer: false,
        include_raw_content: false,
        include_images: false,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { text: "Web search failed.", summary: "failed" };
    payload = await response.json();
  } catch {
    return { text: "Web search failed.", summary: "failed" };
  }

  const results = (payload as { results?: { title?: unknown; url?: unknown; content?: unknown }[] }).results;
  const hits = (results ?? []).flatMap((result) => {
    if (typeof result.title !== "string" || typeof result.url !== "string") return [];
    const url = httpsPage(result.url);
    if (!url) return [];
    return [
      {
        title: result.title.replace(/\s+/g, " ").trim().slice(0, 200),
        url,
        snippet: searchSnippet(typeof result.content === "string" ? result.content : ""),
      },
    ];
  });
  if (hits.length === 0) return { text: "No web results.", summary: "0" };

  const blocks = hits.map((hit) => {
    const source = ctx.registry.add("W", `web:${hit.url}`, (label) => ({
      label,
      kind: "web" as const,
      title: hit.title,
      url: hit.url,
      excerpt: hit.snippet,
    }));
    return `[${source.label}] ${source.title}\n${source.url}\n${source.excerpt}`;
  });
  return { text: blocks.join("\n\n"), summary: String(hits.length) };
}

/** Runs one tool. Bad input comes back as text the model can correct, not an exception. */
export async function runTool(tool: ToolName, rawInput: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const parsed = inputs[tool].safeParse(rawInput);
  if (!parsed.success) {
    return { text: `Invalid input for ${tool}: ${parsed.error.issues[0]?.message ?? "check the shape"}.`, summary: "invalid input" };
  }
  switch (tool) {
    case "search_documents":
      return searchDocuments(ctx, parsed.data as z.infer<typeof inputs.search_documents>);
    case "list_my_tasks":
      return listMyTasks(ctx, parsed.data as z.infer<typeof inputs.list_my_tasks>);
    case "find_tasks":
      return findTasks(ctx, parsed.data as z.infer<typeof inputs.find_tasks>);
    case "get_task":
      return getTask(ctx, parsed.data as z.infer<typeof inputs.get_task>);
    case "search_notes":
      return searchNotes(ctx, parsed.data as z.infer<typeof inputs.search_notes>);
    case "draft_email":
      return writeDraft(ctx, parsed.data as z.infer<typeof inputs.draft_email>);
    case "search_web":
      return searchWeb(ctx, parsed.data as z.infer<typeof inputs.search_web>);
  }
}
