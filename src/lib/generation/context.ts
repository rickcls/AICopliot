import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma, toVectorLiteral } from "@/lib/db";
import type { EmbeddingProvider } from "@/lib/providers";
import { fuseRankedCandidates, type RetrievalCandidate } from "@/lib/rag/ranking";
import { MAX_CONTEXT_CHUNKS } from "./schemas";
import type { GenerationSource, GenerationSourceMap } from "./validate";

export const PLANNING_QUERIES = [
  "project scope objectives requirements deliverables",
  "acceptance criteria UAT testing sign-off definition of done",
  "tasks work activities action items owners schedule",
  "milestones dates phases dependencies prerequisites sequencing",
  "risks constraints blockers assumptions mitigation",
] as const;

type ContextRow = GenerationSource;

interface VectorRow extends ContextRow {
  semanticScore: number;
}

interface LexicalRow extends ContextRow {
  lexicalScore: number;
}

export interface BuiltLabelledContext {
  chunks: GenerationSource[];
  contextBlock: string;
  sourceMap: GenerationSourceMap;
  sourceLabels: Array<{
    label: string;
    chunkId: string;
    documentId: string;
    filename: string;
    pageNumber: number | null;
    sectionTitle: string | null;
  }>;
}

const CANDIDATES_PER_QUERY = 96;
const MAX_PER_DOCUMENT = 8;

function normalizeRows<T extends ContextRow>(rows: T[]): T[] {
  return rows.map((row) => ({
    ...row,
    chunkIndex: Number(row.chunkIndex),
    pageNumber: row.pageNumber === null ? null : Number(row.pageNumber),
  }));
}

async function firstChunks(
  workspaceId: string,
  documentIds: string[],
): Promise<GenerationSource[]> {
  return normalizeRows(
    await prisma.$queryRaw<ContextRow[]>(Prisma.sql`
      SELECT DISTINCT ON (c."documentId")
        c."id", c."documentId", d."originalFilename" AS "filename",
        c."content", c."chunkIndex", c."pageNumber", c."sectionTitle"
      FROM "DocumentChunk" c
      JOIN "Document" d ON d."id" = c."documentId"
      WHERE c."workspaceId" = ${workspaceId}
        AND d."workspaceId" = ${workspaceId}
        AND d."status" = 'ready'
        AND c."documentId" IN (${Prisma.join(documentIds)})
      ORDER BY c."documentId", c."chunkIndex" ASC
    `),
  );
}

async function allChunks(
  workspaceId: string,
  documentIds: string[],
): Promise<GenerationSource[]> {
  return normalizeRows(
    await prisma.$queryRaw<ContextRow[]>(Prisma.sql`
      SELECT
        c."id", c."documentId", d."originalFilename" AS "filename",
        c."content", c."chunkIndex", c."pageNumber", c."sectionTitle"
      FROM "DocumentChunk" c
      JOIN "Document" d ON d."id" = c."documentId"
      WHERE c."workspaceId" = ${workspaceId}
        AND d."workspaceId" = ${workspaceId}
        AND d."status" = 'ready'
        AND c."documentId" IN (${Prisma.join(documentIds)})
      ORDER BY d."createdAt" ASC, c."documentId", c."chunkIndex" ASC
    `),
  );
}

async function retrieveCandidates(
  workspaceId: string,
  documentIds: string[],
  query: string,
  embedding: number[],
) {
  const literal = toVectorLiteral(embedding);
  const [vectorRows, lexicalRows] = await Promise.all([
    prisma.$queryRaw<VectorRow[]>(Prisma.sql`
      SELECT
        c."id", c."documentId", d."originalFilename" AS "filename",
        c."content", c."chunkIndex", c."pageNumber", c."sectionTitle",
        1 - (c."embedding" <=> ${literal}::vector) AS "semanticScore"
      FROM "DocumentChunk" c
      JOIN "Document" d ON d."id" = c."documentId"
      WHERE c."workspaceId" = ${workspaceId}
        AND d."workspaceId" = ${workspaceId}
        AND d."status" = 'ready'
        AND c."embedding" IS NOT NULL
        AND c."documentId" IN (${Prisma.join(documentIds)})
      ORDER BY c."embedding" <=> ${literal}::vector
      LIMIT ${CANDIDATES_PER_QUERY}
    `),
    prisma.$queryRaw<LexicalRow[]>(Prisma.sql`
      WITH query AS (SELECT websearch_to_tsquery('english', ${query}) AS value)
      SELECT
        c."id", c."documentId", d."originalFilename" AS "filename",
        c."content", c."chunkIndex", c."pageNumber", c."sectionTitle",
        ts_rank_cd(to_tsvector('english', c."content"), query.value) AS "lexicalScore"
      FROM "DocumentChunk" c
      JOIN "Document" d ON d."id" = c."documentId"
      CROSS JOIN query
      WHERE c."workspaceId" = ${workspaceId}
        AND d."workspaceId" = ${workspaceId}
        AND d."status" = 'ready'
        AND c."documentId" IN (${Prisma.join(documentIds)})
        AND query.value <> ''::tsquery
        AND to_tsvector('english', c."content") @@ query.value
      ORDER BY "lexicalScore" DESC, c."id" ASC
      LIMIT ${CANDIDATES_PER_QUERY}
    `),
  ]);

  const vectors: RetrievalCandidate[] = normalizeRows(vectorRows).map((row) => ({
    ...row,
    semanticScore: Number(row.semanticScore),
    lexicalScore: 0,
  }));
  const lexical: RetrievalCandidate[] = normalizeRows(lexicalRows).map((row) => ({
    ...row,
    semanticScore: 0,
    lexicalScore: Number(row.lexicalScore),
  }));
  return fuseRankedCandidates(vectors, lexical, CANDIDATES_PER_QUERY);
}

/**
 * Keeps every selected document represented, then fills the remaining budget
 * with fixed-query hybrid retrieval. The final prompt follows source reading
 * order rather than relevance order so adjacent facts remain intelligible.
 *
 * `queries` is the only flow-specific input: plan generation probes for scope
 * and schedule, requirements extraction probes for obligations and acceptance.
 */
export async function selectDocumentContext(
  workspaceId: string,
  documentIds: string[],
  embeddings: EmbeddingProvider,
  queries: readonly string[],
): Promise<GenerationSource[]> {
  const total = await prisma.documentChunk.count({
    where: { workspaceId, documentId: { in: documentIds } },
  });
  if (total <= MAX_CONTEXT_CHUNKS) {
    return allChunks(workspaceId, documentIds);
  }

  const reserved = await firstChunks(workspaceId, documentIds);
  const selected = new Map(reserved.map((chunk) => [chunk.id, chunk]));
  const perDocument = new Map<string, number>();
  for (const chunk of reserved) {
    perDocument.set(chunk.documentId, (perDocument.get(chunk.documentId) ?? 0) + 1);
  }

  const queryEmbeddings = await embeddings.embed([...queries]);
  const rankedLists = await Promise.all(
    queries.map((query, index) =>
      retrieveCandidates(workspaceId, documentIds, query, queryEmbeddings[index]),
    ),
  );

  const scores = new Map<string, { chunk: GenerationSource; score: number }>();
  for (const ranked of rankedLists) {
    ranked.forEach((chunk, rank) => {
      const previous = scores.get(chunk.id);
      scores.set(chunk.id, {
        chunk,
        score: (previous?.score ?? 0) + 1 / (60 + rank + 1),
      });
    });
  }

  const candidates = [...scores.values()].sort(
    (a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id),
  );
  for (const { chunk } of candidates) {
    if (selected.size >= MAX_CONTEXT_CHUNKS) break;
    if (selected.has(chunk.id)) continue;
    const count = perDocument.get(chunk.documentId) ?? 0;
    if (count >= MAX_PER_DOCUMENT) continue;
    selected.set(chunk.id, chunk);
    perDocument.set(chunk.documentId, count + 1);
  }

  // A pathological corpus can exhaust ranked candidates. Fill deterministically
  // without breaking the per-document cap.
  if (selected.size < MAX_CONTEXT_CHUNKS) {
    for (const chunk of await allChunks(workspaceId, documentIds)) {
      if (selected.size >= MAX_CONTEXT_CHUNKS) break;
      if (selected.has(chunk.id)) continue;
      const count = perDocument.get(chunk.documentId) ?? 0;
      if (count >= MAX_PER_DOCUMENT) continue;
      selected.set(chunk.id, chunk);
      perDocument.set(chunk.documentId, count + 1);
    }
  }

  const documentOrder = new Map(documentIds.map((id, index) => [id, index]));
  return [...selected.values()].sort(
    (a, b) =>
      (documentOrder.get(a.documentId) ?? 0) -
        (documentOrder.get(b.documentId) ?? 0) ||
      a.chunkIndex - b.chunkIndex,
  );
}

export function selectPlanContext(
  workspaceId: string,
  documentIds: string[],
  embeddings: EmbeddingProvider,
): Promise<GenerationSource[]> {
  return selectDocumentContext(
    workspaceId,
    documentIds,
    embeddings,
    PLANNING_QUERIES,
  );
}

export function buildLabelledContext(
  chunks: GenerationSource[],
): BuiltLabelledContext {
  const sourceMap: GenerationSourceMap = new Map();
  const sourceLabels: BuiltLabelledContext["sourceLabels"] = [];
  const parts: string[] = [];

  chunks.forEach((chunk, index) => {
    const label = `S${index + 1}`;
    sourceMap.set(label, chunk);
    sourceLabels.push({
      label,
      chunkId: chunk.id,
      documentId: chunk.documentId,
      filename: chunk.filename,
      pageNumber: chunk.pageNumber,
      sectionTitle: chunk.sectionTitle,
    });
    const location = [
      `file: ${chunk.filename}`,
      chunk.pageNumber === null ? null : `page: ${chunk.pageNumber}`,
      chunk.sectionTitle ? `section: ${chunk.sectionTitle}` : null,
    ].filter(Boolean);
    parts.push(`[${label}] (${location.join(", ")})\n${chunk.content}`);
  });

  return {
    chunks,
    sourceMap,
    sourceLabels,
    contextBlock: parts.join("\n\n---\n\n"),
  };
}
