import "server-only";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { formatRequirementCode, BASELINED_REQUIREMENT_STATUS } from "@/lib/pm/rules";
import {
  getChatProvider,
  getEmbeddingProvider,
  type ChatProvider,
  type EmbeddingProvider,
} from "@/lib/providers";
import { hasGroundingEvidence } from "@/lib/rag/ranking";
import { retrieveChunks } from "@/lib/rag/retrieve";
import { buildLabelledContext, selectDocumentContext } from "./context";
import { extractJsonObject } from "./prompt";
import { modelTaskFillSchema } from "./schemas";
import { GenerationRequestError } from "./service";
import {
  buildTaskFillUserMessage,
  LINKED_OVERVIEW_QUERY,
  MAX_FILL_CHUNKS,
  MAX_LINKED_FILL_CHUNKS,
  MAX_FILL_REQUIREMENT_CANDIDATES,
  TASK_FILL_SYSTEM_PROMPT,
} from "./task-fill-prompt";
import {
  validateTaskFill,
  type FilledValue,
  type TaskFillField,
} from "./task-fill-validate";
import type { GenerationSource } from "./validate";

export interface TaskFillDeps {
  chat?: ChatProvider;
  embeddings?: EmbeddingProvider;
  minScore?: number;
}

export interface TaskFillInput {
  workspaceId: string;
  projectId: string;
  title: string;
  description?: string;
  /** The task's own documents. Empty searches the whole project. */
  documentIds: string[];
}

export interface TaskFillSource {
  chunkId: string;
  documentId: string;
  filename: string;
  pageNumber: number | null;
  sectionTitle: string | null;
  excerpt: string;
  /** Which proposed values this passage supports. */
  fields: TaskFillField[];
}

export interface TaskFillResult {
  fill: {
    description: string | null;
    priority: "low" | "medium" | "high" | "urgent" | null;
    estimatedHours: number | null;
    startDate: string | null;
    dueDate: string | null;
    requirements: Array<{ id: string; code: string; title: string; status: string }>;
  };
  sources: TaskFillSource[];
  dropped: TaskFillField[];
  /** Where the evidence came from, so the UI can say what it searched. */
  evidence: "linked" | "project";
  modelName: string;
  latencyMs: number;
}

export const NO_EVIDENCE_MESSAGE =
  "No project document mentions this task. Link or upload a document that describes it, or add more detail to the name.";

function parseFill(raw: string) {
  let value: unknown;
  try {
    value = JSON.parse(extractJsonObject(raw));
  } catch {
    return null;
  }
  const parsed = modelTaskFillSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Evidence for one task.
 *
 * With linked documents, the user has already said where the answer is, so
 * those documents are read in full when small, and when large are probed with
 * the task's name *and* an overview query — the same selection plan generation
 * uses. The name alone is not enough: a task is often named for what to do
 * with a document ("Review the Cliff Deck") rather than for what is in it. Without them, the
 * whole project is searched the way chat searches it, and the same relevance
 * gate applies: a passage must clear RAG_MIN_SCORE or match every query term.
 */
async function selectEvidence(
  input: TaskFillInput,
  query: string,
  embeddings: EmbeddingProvider,
  minScore: number,
): Promise<GenerationSource[]> {
  const { workspaceId, projectId, documentIds } = input;

  if (documentIds.length > 0) {
    const documents = await prisma.document.findMany({
      where: { id: { in: documentIds }, workspaceId, projectId },
      select: { id: true, originalFilename: true, status: true },
    });
    if (documents.length !== documentIds.length) {
      throw new GenerationRequestError(
        "Every linked document must belong to this project",
        400,
      );
    }
    const notReady = documents.filter((document) => document.status !== "ready");
    if (notReady.length > 0) {
      throw new GenerationRequestError(
        `${notReady[0].originalFilename} is not ready yet. Wait for it to finish processing, or unlink it.`,
        409,
      );
    }
    return selectDocumentContext(
      workspaceId,
      documentIds,
      embeddings,
      [query, LINKED_OVERVIEW_QUERY],
      MAX_LINKED_FILL_CHUNKS,
    );
  }

  const [embedding] = await embeddings.embed([query]);
  const retrieved = await retrieveChunks(
    workspaceId,
    embedding,
    query,
    MAX_FILL_CHUNKS,
    projectId,
  );
  return retrieved.filter((chunk) => hasGroundingEvidence(chunk, minScore));
}

/**
 * Proposes values for a task's blank fields from the project's documents.
 *
 * One user-initiated request and one model call (plus at most one repair),
 * like chat. Nothing is persisted: the proposal goes back to the task form,
 * which applies it only to empty fields and saves only when the user does —
 * so there is no draft to review and no generation run to audit.
 */
export async function fillTask(
  input: TaskFillInput,
  deps: TaskFillDeps = {},
): Promise<TaskFillResult> {
  const startedAt = Date.now();
  const embeddings = deps.embeddings ?? getEmbeddingProvider();
  const minScore = deps.minScore ?? getEnv().RAG_MIN_SCORE;

  const query = [input.title, input.description ?? ""]
    .join("\n")
    .trim()
    .slice(0, 1000);

  const [chunks, requirements] = await Promise.all([
    selectEvidence(input, query, embeddings, minScore),
    prisma.requirement.findMany({
      where: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        status: { not: "rejected" },
      },
      orderBy: { sequence: "asc" },
      take: MAX_FILL_REQUIREMENT_CANDIDATES,
      select: { id: true, sequence: true, title: true, status: true },
    }),
  ]);

  // Invariant 4: refuse before spending a model call.
  if (chunks.length === 0) {
    throw new GenerationRequestError(
      input.documentIds.length > 0
        ? "The linked documents do not contain any indexed text"
        : NO_EVIDENCE_MESSAGE,
      422,
    );
  }

  const chat = deps.chat ?? getChatProvider();
  const context = buildLabelledContext(chunks);
  const requirementLabels = new Map(
    requirements.map((requirement, index) => [`Q${index + 1}`, requirement.id]),
  );

  const messages = [
    { role: "system" as const, content: TASK_FILL_SYSTEM_PROMPT },
    {
      role: "user" as const,
      content: buildTaskFillUserMessage({
        title: input.title,
        description: input.description,
        contextBlock: context.contextBlock,
        evidence: input.documentIds.length > 0 ? "linked" : "project",
        requirements: requirements.map((requirement) => ({
          title: requirement.title,
          agreed: BASELINED_REQUIREMENT_STATUS === requirement.status,
        })),
      }),
    },
  ];
  const options = { jsonMode: true, temperature: 0, maxTokens: 1500 };

  const first = await chat.complete(messages, options);
  let parsed = parseFill(first);
  if (!parsed) {
    const second = await chat.complete(
      [
        ...messages,
        { role: "assistant" as const, content: first },
        {
          role: "user" as const,
          content:
            "That reply did not match the required JSON contract. Reply with only one valid JSON object. Use null for anything the sources do not state.",
        },
      ],
      options,
    );
    parsed = parseFill(second);
  }
  if (!parsed) {
    throw new GenerationRequestError(
      "The model returned malformed task data twice. Try again.",
      422,
    );
  }

  const validated = validateTaskFill(parsed, context.sourceMap, requirementLabels);

  const byId = new Map(requirements.map((requirement) => [requirement.id, requirement]));
  const sources = collectSources(
    [
      ["description", validated.description],
      ["priority", validated.priority],
      ["estimatedHours", validated.estimatedHours],
      ["startDate", validated.startDate],
      ["dueDate", validated.dueDate],
    ],
    context.sourceMap,
  );

  return {
    fill: {
      description: validated.description?.value ?? null,
      priority: validated.priority?.value ?? null,
      estimatedHours: validated.estimatedHours?.value ?? null,
      startDate: validated.startDate?.value ?? null,
      dueDate: validated.dueDate?.value ?? null,
      requirements: validated.requirementIds.flatMap((id) => {
        const requirement = byId.get(id);
        return requirement
          ? [
              {
                id,
                code: formatRequirementCode(requirement.sequence),
                title: requirement.title,
                status: requirement.status,
              },
            ]
          : [];
      }),
    },
    sources,
    dropped: validated.dropped,
    evidence: input.documentIds.length > 0 ? "linked" : "project",
    modelName: chat.modelName,
    latencyMs: Date.now() - startedAt,
  };
}

/** One entry per cited passage, listing every field it supports. */
function collectSources(
  fields: Array<[TaskFillField, FilledValue<unknown> | null]>,
  sourceMap: Map<string, GenerationSource>,
): TaskFillSource[] {
  const sources = new Map<string, TaskFillSource>();
  for (const [field, filled] of fields) {
    for (const citation of filled?.citations ?? []) {
      const chunk = sourceMap.get(citation.sourceId);
      if (!chunk) continue;
      const existing = sources.get(chunk.id);
      if (existing) {
        if (!existing.fields.includes(field)) existing.fields.push(field);
        continue;
      }
      sources.set(chunk.id, {
        chunkId: chunk.id,
        documentId: chunk.documentId,
        filename: chunk.filename,
        pageNumber: chunk.pageNumber,
        sectionTitle: chunk.sectionTitle,
        excerpt: citation.excerpt,
        fields: [field],
      });
    }
  }
  return [...sources.values()];
}
