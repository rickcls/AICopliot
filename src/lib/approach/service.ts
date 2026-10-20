import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { getUserPreferences, type WorkspaceAccess } from "@/lib/auth-guard";
import {
  APPROACH_PROMPT_VERSION,
  APPROACH_SYSTEM_PROMPT,
  buildApproachUserMessage,
  MAX_APPROACH_CHUNKS,
  modelApproachSchema,
  validateApproach,
  type ApproachSource,
  type ApproachStep,
} from "@/lib/approach/approach";
import { stepTitle } from "@/lib/approach/format";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { buildLabelledContext, selectDocumentContext } from "@/lib/generation/context";
import { extractJsonObject } from "@/lib/generation/prompt";
import type { GenerationSource } from "@/lib/generation/validate";
import { detectReplyLanguage } from "@/lib/language";
import { officialRecordWhere } from "@/lib/pm/rules";
import { createTaskRecord, prepareTaskCreate } from "@/lib/pm/task-write";
import {
  getChatProvider,
  getEmbeddingProvider,
  type ChatProvider,
  type EmbeddingProvider,
} from "@/lib/providers";
import { hasGroundingEvidence } from "@/lib/rag/ranking";
import { retrieveChunks } from "@/lib/rag/retrieve";
import { createTaskSchema } from "@/lib/schemas";

export class ApproachError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 422,
  ) {
    super(message);
    this.name = "ApproachError";
  }
}

export interface ApproachView {
  id: string;
  steps: ApproachStep[];
  sources: ApproachSource[];
  note: string | null;
  evidence: "linked" | "project" | "none";
  createdSteps: number[];
  createdAt: string;
}

function toView(row: {
  id: string;
  steps: unknown;
  sources: unknown;
  note: string | null;
  evidence: string;
  createdSteps: number[];
  createdAt: Date;
}): ApproachView {
  return {
    id: row.id,
    steps: row.steps as ApproachStep[],
    sources: row.sources as ApproachSource[],
    note: row.note,
    evidence: row.evidence as ApproachView["evidence"],
    createdSteps: row.createdSteps,
    createdAt: row.createdAt.toISOString(),
  };
}

function parseApproach(raw: string) {
  try {
    const parsed = modelApproachSchema.safeParse(JSON.parse(extractJsonObject(raw)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The person's latest suggestion for this task, if they asked before. */
export async function getLatestApproach(access: WorkspaceAccess, taskId: string) {
  const row = await prisma.taskSuggestion.findFirst({
    where: { workspaceId: access.workspaceId, userId: access.userId, taskId },
    orderBy: { createdAt: "desc" },
  });
  return row ? toView(row) : null;
}

/**
 * Evidence, best first: the task's own linked documents; otherwise the
 * project's documents, held to the chat's evidence bar. Possibly nothing —
 * and unlike chat, the model is still asked, because every step it then gives
 * is labelled as its own general suggestion.
 */
async function gatherEvidence(
  workspaceId: string,
  task: { id: string; projectId: string; title: string; description: string | null },
  embeddings: EmbeddingProvider,
): Promise<{ chunks: GenerationSource[]; evidence: ApproachView["evidence"] }> {
  const query = [task.title, task.description ?? ""].join("\n").trim().slice(0, 1000);
  const linked = await prisma.taskDocument.findMany({
    where: { workspaceId, taskId: task.id, document: { status: "ready" } },
    select: { documentId: true },
  });
  try {
    if (linked.length > 0) {
      const chunks = await selectDocumentContext(
        workspaceId,
        linked.map((link) => link.documentId),
        embeddings,
        [query],
        MAX_APPROACH_CHUNKS,
      );
      return { chunks, evidence: chunks.length > 0 ? "linked" : "none" };
    }
    const [vector] = await embeddings.embed([query]);
    const retrieved = await retrieveChunks(workspaceId, vector, query, 8, task.projectId);
    const minScore = getEnv().RAG_MIN_SCORE;
    const chunks = retrieved.filter((chunk) => hasGroundingEvidence(chunk, minScore));
    return { chunks, evidence: chunks.length > 0 ? "project" : "none" };
  } catch {
    // No embeddings, no evidence: the suggestion can still be general.
    return { chunks: [], evidence: "none" };
  }
}

export async function suggestApproach(
  access: WorkspaceAccess,
  taskId: string,
  deps: { chat?: ChatProvider; embeddings?: EmbeddingProvider } = {},
): Promise<ApproachView> {
  const task = await prisma.task.findFirst({
    where: officialRecordWhere({ id: taskId, workspaceId: access.workspaceId }),
    select: {
      id: true,
      title: true,
      description: true,
      projectId: true,
      dueDate: true,
      project: { select: { name: true } },
      status: { select: { category: true } },
    },
  });
  if (!task) throw new ApproachError("Task not found", 404);

  const preferences = await getUserPreferences(access.userId);
  const language = detectReplyLanguage(
    `${task.title}\n${task.description ?? ""}`,
    preferences?.locale === "en" ? "en" : "zh-Hant",
  );

  const { chunks, evidence } = await gatherEvidence(
    access.workspaceId,
    task,
    deps.embeddings ?? getEmbeddingProvider(),
  );
  const context = buildLabelledContext(chunks);

  const chat = deps.chat ?? getChatProvider();
  const messages = [
    { role: "system" as const, content: APPROACH_SYSTEM_PROMPT },
    {
      role: "user" as const,
      content: buildApproachUserMessage({
        task: {
          title: task.title,
          description: task.description,
          project: task.project.name,
          status: task.status.category,
          due: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : "none",
        },
        contextBlock: chunks.length > 0 ? context.contextBlock : "",
        language,
      }),
    },
  ];
  const options = { jsonMode: true, temperature: 0, maxTokens: 3000, reasoning: false };

  let raw = await chat.complete(messages, options);
  let model = parseApproach(raw);
  if (!model) {
    raw = await chat.complete(
      [
        ...messages,
        { role: "assistant" as const, content: raw },
        { role: "user" as const, content: 'Reply with only one JSON object: {"steps":[...],"note":...}.' },
      ],
      options,
    );
    model = parseApproach(raw);
  }
  if (!model) throw new ApproachError("The model returned malformed steps twice. Try again.", 422);

  const validated = validateApproach(model, context.sourceMap, language);
  if (validated.steps.length === 0) {
    throw new ApproachError("No steps came back. Try again, or add a description to the task.", 422);
  }

  const row = await prisma.taskSuggestion.create({
    data: {
      workspaceId: access.workspaceId,
      userId: access.userId,
      taskId: task.id,
      steps: validated.steps as unknown as Prisma.InputJsonValue,
      sources: validated.sources as unknown as Prisma.InputJsonValue,
      note: validated.note,
      evidence,
      modelName: chat.modelName,
      promptVersion: APPROACH_PROMPT_VERSION,
    },
  });
  return toView(row);
}

/**
 * Turns chosen steps into tasks in the same project, assigned to the person.
 * Each step is claimed (its index pushed onto `createdSteps` only if absent)
 * in the same transaction as its task, so a second click creates nothing.
 * General steps keep their marker in the new task's description.
 */
export async function createTasksFromSteps(
  access: WorkspaceAccess,
  suggestionId: string,
  stepIndexes: number[],
  generalMarker: string,
) {
  const suggestion = await prisma.taskSuggestion.findFirst({
    where: { id: suggestionId, workspaceId: access.workspaceId, userId: access.userId },
    select: { id: true, steps: true, task: { select: { projectId: true, title: true } } },
  });
  if (!suggestion) throw new ApproachError("Suggestion not found", 404);
  const steps = suggestion.steps as unknown as ApproachStep[];

  const created = [];
  for (const index of [...new Set(stepIndexes)]) {
    const step = steps[index];
    if (!step) continue;
    const input = createTaskSchema.parse({
      title: stepTitle(step.text),
      description: `${step.basis === "general" ? `${generalMarker} ` : ""}${step.text}\n\n— ${suggestion.task.title}`,
      priority: "medium",
      assigneeId: access.userId,
    });
    const prepared = await prepareTaskCreate(access.workspaceId, suggestion.task.projectId, input);
    if (!prepared.ok) throw new ApproachError(prepared.error, 404);

    const task = await prisma.$transaction(async (tx) => {
      const claimed = await tx.taskSuggestion.updateMany({
        where: {
          id: suggestion.id,
          userId: access.userId,
          NOT: { createdSteps: { has: index } },
        },
        data: { createdSteps: { push: index } },
      });
      if (claimed.count === 0) return null;
      return createTaskRecord(tx, prepared.value, access.userId);
    });
    if (task) created.push(task);
  }
  return created;
}
