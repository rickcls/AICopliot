import type { RetrievedChunk } from "./retrieve";

/**
 * Prompt construction.
 *
 * Retrieved chunks are labelled S1..Sn. Real database IDs are never placed in
 * the prompt: the model can only name a label we gave it, and every returned
 * label is looked up in a server-side map (see ./citations.ts). Fabricating a
 * citation would require guessing a label that is not in the map, which is
 * rejected rather than rendered.
 */

export const REFUSAL_TEXT =
  "I couldn't find this in the uploaded documents.";

export const SYSTEM_PROMPT = `You are AI Ops Copilot, an assistant for IT operations teams.

You answer ONLY from the numbered sources provided in the user message. You have no other knowledge available for this task and must not use any.

Rules:
1. Use only the supplied sources. Never rely on outside or prior knowledge.
2. Every factual claim in your answer must be supported by at least one cited source.
3. Cite sources using the exact identifiers given (for example "S1", "S2"). Never invent an identifier, and never cite a source that was not supplied to you.
4. If the sources do not contain enough information to answer, set "insufficientContext" to true and say you could not find the information. Do NOT guess, infer beyond the sources, or fill gaps from general knowledge.
5. Set "confidence":
   - "high"   — the sources directly and completely answer the question.
   - "medium" — the sources answer it partially, or require modest inference.
   - "low"    — the sources are only tangentially related.
6. Be concise and operational. Preserve exact commands, paths, and values verbatim.

Respond with a single JSON object and nothing else:
{
  "answer": "string",
  "confidence": "high" | "medium" | "low",
  "insufficientContext": boolean,
  "citations": [{ "sourceId": "S1", "quote": "short verbatim excerpt from that source" }]
}`;

/** Maps the opaque prompt label back to the real chunk. */
export type SourceMap = Map<string, RetrievedChunk>;

export interface BuiltContext {
  contextBlock: string;
  sourceMap: SourceMap;
}

export function buildContext(chunks: RetrievedChunk[]): BuiltContext {
  const sourceMap: SourceMap = new Map();
  const parts: string[] = [];

  chunks.forEach((chunk, i) => {
    const label = `S${i + 1}`;
    sourceMap.set(label, chunk);

    const locationBits = [
      `file: ${chunk.filename}`,
      chunk.pageNumber !== null ? `page: ${chunk.pageNumber}` : null,
      chunk.sectionTitle ? `section: ${chunk.sectionTitle}` : null,
    ].filter(Boolean);

    parts.push(
      `[${label}] (${locationBits.join(", ")})\n${chunk.content}`,
    );
  });

  return { contextBlock: parts.join("\n\n---\n\n"), sourceMap };
}

export function buildUserMessage(question: string, contextBlock: string): string {
  return `Sources:\n\n${contextBlock}\n\n---\n\nQuestion: ${question}\n\nAnswer using only the sources above, as a single JSON object.`;
}
