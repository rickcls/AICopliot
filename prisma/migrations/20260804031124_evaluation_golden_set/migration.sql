-- NOTE: Prisma generated a `DROP INDEX "DocumentChunk_embedding_hnsw_idx"` here
-- and it was removed by hand. Prisma cannot see raw-SQL indexes on Unsupported()
-- columns, so it treats the pgvector HNSW index as drift on EVERY migration.
-- Dropping it does not break correctness -- it silently turns vector search into
-- a sequential scan. Always delete that DROP. The guard at the bottom of this
-- file restores the index if an earlier migration removed it.

-- AlterTable
ALTER TABLE "EvaluationCase" ADD COLUMN     "autoScore" BOOLEAN,
ADD COLUMN     "citationCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "expectedKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "shouldRefuse" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Safety net: recreate the pgvector index if a previous migration dropped it.
CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_idx"
    ON "DocumentChunk" USING hnsw ("embedding" vector_cosine_ops);
