-- The day's plan keeps the note the person wrote, so a meeting or a focus
-- stays visible after the suggestion is saved.

-- AlterTable
ALTER TABLE "DailyPlan" ADD COLUMN "note" TEXT;

-- Guard: Prisma cannot see raw-SQL indexes on Unsupported() columns and emits a
-- DROP for the pgvector index on every migration. Recreate it if that happened.
CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_idx"
    ON "DocumentChunk" USING hnsw ("embedding" vector_cosine_ops);
