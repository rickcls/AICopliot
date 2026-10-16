import "server-only";
import type { WorkspaceAccess } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { snippetAround } from "@/lib/documents/snippet";
import { getEnv } from "@/lib/env";
import { getEmbeddingProvider, type EmbeddingProvider } from "@/lib/providers";
import { hasGroundingEvidence } from "@/lib/rag/ranking";
import { retrieveChunks } from "@/lib/rag/retrieve";

export type SearchMatch = "text" | "label" | "meaning";

export interface DocumentSearchHit {
  documentId: string;
  title: string | null;
  filename: string;
  projectId: string | null;
  projectName: string | null;
  snippet: string;
  /** Character range of the match inside `snippet`, when it is literal. */
  match: [number, number] | null;
  chunkId: string | null;
  pageNumber: number | null;
  kind: SearchMatch;
}

const MAX_RESULTS = 30;
export const MIN_QUERY_LENGTH = 2;

/**
 * Finds documents by what is in them, not only by filename.
 *
 * Literal matching is `ILIKE` over every indexed chunk and over the filing
 * labels, which works for Chinese: there is no word segmentation to get
 * wrong, a phrase either appears or it does not. Meaning matching is the
 * same hybrid retrieval chat uses, held to the same evidence bar
 * (`hasGroundingEvidence`), and is skipped quietly if the embedding provider
 * is unavailable — search must still work without it.
 *
 * This is search, not grounding: results are links to read, never evidence
 * handed to a model, so the retrieval invariants are not loosened by it.
 */
export async function searchDocuments(
  access: WorkspaceAccess,
  rawQuery: string,
  deps: { embeddings?: EmbeddingProvider } = {},
): Promise<DocumentSearchHit[]> {
  const query = rawQuery.trim().slice(0, 200);
  if (query.length < MIN_QUERY_LENGTH) return [];
  const { workspaceId } = access;

  const [textChunks, labelled, meaning] = await Promise.all([
    prisma.documentChunk.findMany({
      where: {
        workspaceId,
        document: { workspaceId, status: "ready" },
        content: { contains: query, mode: "insensitive" },
      },
      orderBy: [{ documentId: "asc" }, { chunkIndex: "asc" }],
      take: 200,
      select: { id: true, documentId: true, content: true, pageNumber: true },
    }),
    prisma.document.findMany({
      where: {
        workspaceId,
        OR: [
          { originalFilename: { contains: query, mode: "insensitive" } },
          { title: { contains: query, mode: "insensitive" } },
          { summary: { contains: query, mode: "insensitive" } },
          { tags: { has: query } },
        ],
      },
      take: 50,
      select: { id: true, summary: true },
    }),
    (async () => {
      try {
        const embeddings = deps.embeddings ?? getEmbeddingProvider();
        const [vector] = await embeddings.embed([query]);
        const chunks = await retrieveChunks(workspaceId, vector, query, 20);
        const minScore = getEnv().RAG_MIN_SCORE;
        return chunks.filter((chunk) => hasGroundingEvidence(chunk, minScore));
      } catch {
        return [];
      }
    })(),
  ]);

  const hits = new Map<string, Omit<DocumentSearchHit, "title" | "filename" | "projectId" | "projectName">>();
  for (const chunk of textChunks) {
    if (hits.has(chunk.documentId)) continue;
    const snippet = snippetAround(chunk.content, query);
    hits.set(chunk.documentId, {
      documentId: chunk.documentId,
      snippet: snippet.text,
      match: snippet.match,
      chunkId: chunk.id,
      pageNumber: chunk.pageNumber,
      kind: "text",
    });
  }
  for (const document of labelled) {
    if (hits.has(document.id)) continue;
    const snippet = snippetAround(document.summary ?? "", query);
    hits.set(document.id, {
      documentId: document.id,
      snippet: snippet.text,
      match: snippet.match,
      chunkId: null,
      pageNumber: null,
      kind: "label",
    });
  }
  for (const chunk of meaning) {
    if (hits.has(chunk.documentId)) continue;
    const snippet = snippetAround(chunk.content, "");
    hits.set(chunk.documentId, {
      documentId: chunk.documentId,
      snippet: snippet.text,
      match: null,
      chunkId: chunk.id,
      pageNumber: chunk.pageNumber,
      kind: "meaning",
    });
  }

  const ordered = [...hits.values()].slice(0, MAX_RESULTS);
  const documents = await prisma.document.findMany({
    where: { workspaceId, id: { in: ordered.map((hit) => hit.documentId) } },
    select: {
      id: true,
      title: true,
      originalFilename: true,
      projectId: true,
      project: { select: { name: true } },
    },
  });
  const byId = new Map(documents.map((document) => [document.id, document]));

  return ordered.flatMap((hit) => {
    const document = byId.get(hit.documentId);
    return document
      ? [
          {
            ...hit,
            title: document.title,
            filename: document.originalFilename,
            projectId: document.projectId,
            projectName: document.project?.name ?? null,
          },
        ]
      : [];
  });
}
