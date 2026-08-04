import "server-only";
import { prisma, toVectorLiteral } from "@/lib/db";
import {
  fuseRankedCandidates,
  type RetrievalCandidate,
  type RetrievedChunk,
} from "./ranking";

export type { RetrievedChunk } from "./ranking";

type RawCandidate = Omit<RetrievalCandidate, "semanticScore" | "lexicalScore">;

interface VectorRow extends RawCandidate {
  semanticScore: number;
}

interface LexicalRow extends RawCandidate {
  lexicalScore: number;
}

/**
 * Workspace-scoped hybrid search.
 *
 * The workspace filter is inside the SQL, not applied to the results
 * afterwards. Filtering after the fact would let another workspace's chunks
 * consume the LIMIT and silently degrade recall — and would be one refactor
 * away from leaking them.
 */
export async function retrieveChunks(
  workspaceId: string,
  queryEmbedding: number[],
  query: string,
  topK: number,
  projectId: string | null = null,
): Promise<RetrievedChunk[]> {
  const literal = toVectorLiteral(queryEmbedding);
  const candidateLimit = Math.min(Math.max(topK * 4, topK), 200);

  const [vectorRows, lexicalRows] = await Promise.all([
    prisma.$queryRaw<VectorRow[]>`
      SELECT
        c."id",
        c."documentId",
        d."originalFilename" AS "filename",
        c."content",
        c."chunkIndex",
        c."pageNumber",
        c."sectionTitle",
        1 - (c."embedding" <=> ${literal}::vector) AS "semanticScore"
      FROM "DocumentChunk" c
      JOIN "Document" d ON d."id" = c."documentId"
      WHERE c."workspaceId" = ${workspaceId}
        AND d."workspaceId" = ${workspaceId}
        AND (${projectId}::text IS NULL OR d."projectId" = ${projectId})
        AND d."status" = 'ready'
        AND c."embedding" IS NOT NULL
      ORDER BY c."embedding" <=> ${literal}::vector
      LIMIT ${candidateLimit}
    `,
    prisma.$queryRaw<LexicalRow[]>`
      WITH query AS (
        SELECT websearch_to_tsquery('english', ${query}) AS value
      )
      SELECT
        c."id",
        c."documentId",
        d."originalFilename" AS "filename",
        c."content",
        c."chunkIndex",
        c."pageNumber",
        c."sectionTitle",
        ts_rank_cd(to_tsvector('english', c."content"), query.value) AS "lexicalScore"
      FROM "DocumentChunk" c
      JOIN "Document" d ON d."id" = c."documentId"
      CROSS JOIN query
      WHERE c."workspaceId" = ${workspaceId}
        AND d."workspaceId" = ${workspaceId}
        AND (${projectId}::text IS NULL OR d."projectId" = ${projectId})
        AND d."status" = 'ready'
        AND query.value <> ''::tsquery
        AND to_tsvector('english', c."content") @@ query.value
      ORDER BY "lexicalScore" DESC, c."id" ASC
      LIMIT ${candidateLimit}
    `,
  ]);

  // Postgres returns numerics as strings through some driver paths.
  const vectorCandidates = vectorRows.map((row) => ({
    ...row,
    semanticScore: Number(row.semanticScore),
    lexicalScore: 0,
    chunkIndex: Number(row.chunkIndex),
    pageNumber: row.pageNumber === null ? null : Number(row.pageNumber),
  }));
  const lexicalCandidates = lexicalRows.map((row) => ({
    ...row,
    semanticScore: 0,
    lexicalScore: Number(row.lexicalScore),
    chunkIndex: Number(row.chunkIndex),
    pageNumber: row.pageNumber === null ? null : Number(row.pageNumber),
  }));

  return fuseRankedCandidates(vectorCandidates, lexicalCandidates, topK);
}
