import "server-only";
import { selectDocumentContext } from "@/lib/generation/context";
import type { EmbeddingProvider } from "@/lib/providers";
import type { RetrievedChunk } from "./ranking";

/**
 * Documents a person chose to ask about — focused in Ask documents, attached
 * in the assistant — are read, not searched. Similarity search hands the
 * model the few passages nearest the question, which cannot answer "what is
 * the difference between these two quotes" or "summarise this": the answer
 * spans every file. So the files are read whole when they fit the budget,
 * and otherwise each keeps its opening and gets the passages nearest the
 * question, in reading order (`selectDocumentContext`, the plan generator's
 * reader). They are the evidence the person picked, so no similarity bar
 * applies; citations still name each passage.
 */
export const MAX_CHOSEN_CHUNKS = 24;

export async function readChosenDocuments(
  workspaceId: string,
  documentIds: string[],
  embeddings: EmbeddingProvider,
  question: string,
  maxChunks: number = MAX_CHOSEN_CHUNKS,
): Promise<RetrievedChunk[]> {
  const passages = await selectDocumentContext(workspaceId, documentIds, embeddings, [question], maxChunks);
  return passages.map((passage) => ({ ...passage, score: 0, lexicalScore: 0, matchType: "read" as const }));
}
