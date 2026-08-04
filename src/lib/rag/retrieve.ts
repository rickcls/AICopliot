import "server-only";
import { prisma, toVectorLiteral } from "@/lib/db";

/** A chunk returned by vector search, with its similarity score. */
export interface RetrievedChunk {
  id: string;
  documentId: string;
  filename: string;
  content: string;
  chunkIndex: number;
  pageNumber: number | null;
  sectionTitle: string | null;
  score: number;
}

/**
 * Workspace-scoped nearest-neighbour search.
 *
 * The workspace filter is inside the SQL, not applied to the results
 * afterwards. Filtering after the fact would let another workspace's chunks
 * consume the LIMIT and silently degrade recall — and would be one refactor
 * away from leaking them.
 */
export async function retrieveChunks(
  workspaceId: string,
  queryEmbedding: number[],
  topK: number,
): Promise<RetrievedChunk[]> {
  const literal = toVectorLiteral(queryEmbedding);

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      documentId: string;
      filename: string;
      content: string;
      chunkIndex: number;
      pageNumber: number | null;
      sectionTitle: string | null;
      score: number;
    }>
  >`
    SELECT
      c."id",
      c."documentId",
      d."originalFilename" AS "filename",
      c."content",
      c."chunkIndex",
      c."pageNumber",
      c."sectionTitle",
      1 - (c."embedding" <=> ${literal}::vector) AS "score"
    FROM "DocumentChunk" c
    JOIN "Document" d ON d."id" = c."documentId"
    WHERE c."workspaceId" = ${workspaceId}
      AND d."workspaceId" = ${workspaceId}
      AND d."status" = 'ready'
      AND c."embedding" IS NOT NULL
    ORDER BY c."embedding" <=> ${literal}::vector
    LIMIT ${topK}
  `;

  // Postgres returns numerics as strings through some driver paths.
  return rows.map((r) => ({
    ...r,
    score: Number(r.score),
    chunkIndex: Number(r.chunkIndex),
    pageNumber: r.pageNumber === null ? null : Number(r.pageNumber),
  }));
}
