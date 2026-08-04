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
}

export interface AnswerDeps {
  embeddings?: EmbeddingProvider;
  chat?: ChatProvider;
  topK?: number;
  minScore?: number;
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

  const [queryEmbedding] = await embeddings.embed([question]);
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
    };
  }

  const { contextBlock, sourceMap } = buildContext(relevant);
  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: buildUserMessage(question, contextBlock) },
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
  };
}
