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
import { buildContext, buildUserMessage, SYSTEM_PROMPT } from "./prompt";
import { retrieveChunks, type RetrievedChunk } from "./retrieve";
import { rewriteQuestion, type ChatTurn } from "./rewrite";

/**
 * Question answering.
 *
 * Two independent guards keep answers grounded:
 *   1. A retrieval gate BEFORE the model is called — if nothing clears
 *      RAG_MIN_SCORE there is no evidence to reason over, so we refuse without
 *      spending a request. Deterministic and cheap.
 *   2. Citation validation AFTER the model replies (see ./citations.ts).
 */

export interface AnswerResult extends ValidatedAnswer {
  retrievedChunkIds: string[];
  retrievedChunks: RetrievedChunk[];
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
}

/** Turns of history included in the answering prompt (assistant turns included). */
const HISTORY_TURNS_IN_PROMPT = 6;

function buildHistoryMessages(history: ChatTurn[]) {
  return history.slice(-HISTORY_TURNS_IN_PROMPT).map((turn) => ({
    role: turn.role,
    content: turn.content.slice(0, 1000),
  }));
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

  // Resolve pronouns and implied subjects against the conversation BEFORE
  // embedding — retrieval quality depends on the standalone form, not the
  // literal follow-up.
  const searchQuery = await rewriteQuestion(question, history, chat);

  const [queryEmbedding] = await embeddings.embed([searchQuery]);
  const retrieved = await retrieveChunks(workspaceId, queryEmbedding, topK);

  // --- Guard 1: refuse before calling the model when evidence is too weak ---
  const relevant = retrieved.filter((c) => c.score >= minScore);
  if (relevant.length === 0) {
    return {
      ...refusal(),
      retrievedChunkIds: retrieved.map((c) => c.id),
      retrievedChunks: [],
      modelName: chat.modelName,
      latencyMs: Date.now() - startedAt,
      searchQuery,
    };
  }

  const { contextBlock, sourceMap } = buildContext(relevant);
  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    // History gives the model the thread's wording; the sources remain the only
    // permitted basis for factual claims.
    ...buildHistoryMessages(history),
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
      ...refusal(),
      retrievedChunkIds: relevant.map((c) => c.id),
      retrievedChunks: relevant,
      modelName: chat.modelName,
      latencyMs: Date.now() - startedAt,
      searchQuery,
    };
  }

  // --- Guard 2: drop uncitable claims ---
  const validated = validateAnswer(parsed, sourceMap);

  return {
    ...validated,
    retrievedChunkIds: relevant.map((c) => c.id),
    retrievedChunks: relevant,
    modelName: chat.modelName,
    latencyMs: Date.now() - startedAt,
    searchQuery,
  };
}
