import "server-only";
import { getEnv } from "@/lib/env";
import {
  getChatProvider,
  getEmbeddingProvider,
  type ChatProvider,
  type EmbeddingProvider,
} from "@/lib/providers";
import { modelAnswerSchema } from "@/lib/schemas";
import { refusal, validateAnswer, type ValidatedAnswer } from "./citations";
import {
  buildCombinedContext,
  buildContext,
  buildUserMessage,
  PROJECT_REFUSAL_TEXT,
  PROJECT_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  type GroundingSourceAudit,
} from "./prompt";
import {
  getProjectGroundingContext,
  type ProjectGroundingContext,
} from "./project-context";
import { hasGroundingEvidence } from "./ranking";
import { retrieveChunks, type RetrievedChunk } from "./retrieve";
import { rewriteQuestion, type ChatTurn } from "./rewrite";

/**
 * Question answering.
 *
 * Two independent guards keep answers grounded:
 *   1. A retrieval gate BEFORE the model is called — if nothing clears
 *      RAG_MIN_SCORE (or the lexical path) there is no evidence to reason over,
 *      so we refuse without spending a request. Deterministic and cheap.
 *   2. Citation validation AFTER the model replies (see ./citations.ts).
 */

export interface AnswerResult extends ValidatedAnswer {
  retrievedChunkIds: string[];
  retrievedChunks: RetrievedChunk[];
  groundingSourceIds: GroundingSourceAudit[];
  modelName: string;
  latencyMs: number;
  /** The standalone question actually embedded; differs on follow-ups. */
  searchQuery: string;
}

export interface AnswerDeps {
  embeddings?: EmbeddingProvider;
  chat?: ChatProvider;
  topK?: number;
  minScore?: number;
  /** Prior turns, oldest first. Empty for the first question in a thread. */
  history?: ChatTurn[];
  projectId?: string | null;
  groundingScope?: "documents" | "project_combined";
  projectContext?: typeof getProjectGroundingContext;
}

/** Models sometimes wrap JSON in prose or a fenced block; recover the object. */
function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced) return fenced[1].trim();

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) return trimmed.slice(start, end + 1);

  return trimmed;
}

function parseModelAnswer(raw: string) {
  const candidate = extractJsonObject(raw);
  let json: unknown;
  try {
    json = JSON.parse(candidate);
  } catch {
    return null;
  }
  const parsed = modelAnswerSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export async function answerQuestion(
  workspaceId: string,
  question: string,
  deps: AnswerDeps = {},
): Promise<AnswerResult> {
  const startedAt = Date.now();
  const env = getEnv();

  const embeddings = deps.embeddings ?? getEmbeddingProvider();
  const chat = deps.chat ?? getChatProvider();
  const topK = deps.topK ?? env.RAG_TOP_K;
  const minScore = deps.minScore ?? env.RAG_MIN_SCORE;

  const history = deps.history ?? [];
  const combined =
    deps.groundingScope === "project_combined" && Boolean(deps.projectId);
  const refusalText = combined ? PROJECT_REFUSAL_TEXT : undefined;

  // Resolve pronouns and implied subjects against the conversation BEFORE
  // embedding — retrieval quality depends on the standalone form, not the
  // literal follow-up.
  const searchQuery = await rewriteQuestion(question, history, chat);

  const emptyProjectContext: ProjectGroundingContext = {
    sources: [],
    observedAt: new Date().toISOString(),
    hasProjectData: false,
    totalDetailedRecords: 0,
    selectedDetailedRecords: 0,
    partial: false,
  };
  const projectContext = deps.projectContext ?? getProjectGroundingContext;
  const [retrieved, liveContext] = await Promise.all([
    embeddings.embed([searchQuery]).then(([queryEmbedding]) =>
      retrieveChunks(
        workspaceId,
        queryEmbedding,
        searchQuery,
        topK,
        deps.projectId ?? null,
      ),
    ),
    combined && deps.projectId
      ? projectContext(workspaceId, deps.projectId, searchQuery)
      : Promise.resolve(emptyProjectContext),
  ]);

  // --- Guard 1: refuse before calling the model when evidence is too weak ---
  const relevant = retrieved.filter((c) => hasGroundingEvidence(c, minScore));
  if (relevant.length === 0 && liveContext.sources.length === 0) {
    return {
      ...refusal(refusalText),
      retrievedChunkIds: retrieved.map((c) => c.id),
      retrievedChunks: [],
      groundingSourceIds: [],
      modelName: chat.modelName,
      latencyMs: Date.now() - startedAt,
      searchQuery,
    };
  }

  const { contextBlock, sourceMap, groundingSources } = combined
    ? buildCombinedContext(relevant, liveContext.sources)
    : buildContext(relevant);
  const messages = [
    {
      role: "system" as const,
      content: combined ? PROJECT_SYSTEM_PROMPT : SYSTEM_PROMPT,
    },
    // Conversation history was used to rewrite `searchQuery` above, but is not
    // sent to the answering model. This makes it structurally impossible for a
    // prior assistant claim to become evidence alongside the supplied sources.
    { role: "user" as const, content: buildUserMessage(searchQuery, contextBlock) },
  ];

  let parsed = parseModelAnswer(
    await chat.complete(messages, { jsonMode: true, temperature: 0 }),
  );

  // One repair attempt before giving up on malformed output.
  if (!parsed) {
    parsed = parseModelAnswer(
      await chat.complete(
        [
          ...messages,
          {
            role: "user" as const,
            content:
              "Your previous reply was not valid JSON. Reply with ONLY the JSON object described in the system prompt.",
          },
        ],
        { jsonMode: true, temperature: 0 },
      ),
    );
  }

  // Unparseable output is treated as no answer rather than shown raw.
  if (!parsed) {
    return {
      ...refusal(refusalText),
      retrievedChunkIds: relevant.map((c) => c.id),
      retrievedChunks: relevant,
      groundingSourceIds: groundingSources,
      modelName: chat.modelName,
      latencyMs: Date.now() - startedAt,
      searchQuery,
    };
  }

  // --- Guard 2: drop uncitable claims ---
  const validated = validateAnswer(parsed, sourceMap, {
    refusalText,
    requireMixedHeadings: combined,
    question: searchQuery,
    enforceIntentFamilies: combined,
  });

  return {
    ...validated,
    retrievedChunkIds: relevant.map((c) => c.id),
    retrievedChunks: relevant,
    groundingSourceIds: groundingSources,
    modelName: chat.modelName,
    latencyMs: Date.now() - startedAt,
    searchQuery,
  };
}
