-- AlterTable: per-person UI language and the time zone that decides "today".
ALTER TABLE "User" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'zh-Hant';
ALTER TABLE "User" ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'Asia/Hong_Kong';

-- AlterTable: requirements discovery becomes an optional per-project layer.
-- New projects start without it.
ALTER TABLE "Project" ADD COLUMN "discoveryEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: every existing project was created by the discovery product, where
-- the Requirements tab was always present. Keep it, so nobody loses a view they
-- work in — the same rule the deliveryEnabled backfill followed.
UPDATE "Project" SET "discoveryEnabled" = true;

-- Guard: Prisma cannot see raw-SQL indexes on Unsupported() columns and emits a
-- DROP for the pgvector index on every migration. Recreate it if that happened.
CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_idx"
    ON "DocumentChunk" USING hnsw ("embedding" vector_cosine_ops);
