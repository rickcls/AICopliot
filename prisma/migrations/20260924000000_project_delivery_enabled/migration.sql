-- AlterTable: delivery tools (tasks, timeline, risks, plan, reports) are an
-- optional per-project layer. New projects start with requirements discovery
-- only.
ALTER TABLE "Project" ADD COLUMN "deliveryEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: a project already using any delivery record keeps its tabs, so
-- nobody loses a view they work in. Drafts count too — a plan awaiting review
-- lives on a delivery tab.
UPDATE "Project" p
SET "deliveryEnabled" = true
WHERE EXISTS (SELECT 1 FROM "Task" t WHERE t."projectId" = p."id")
   OR EXISTS (SELECT 1 FROM "Milestone" m WHERE m."projectId" = p."id")
   OR EXISTS (SELECT 1 FROM "ProjectRisk" r WHERE r."projectId" = p."id")
   OR EXISTS (
     SELECT 1 FROM "GenerationRun" g
     WHERE g."projectId" = p."id" AND g."type" <> 'requirements'
   );

-- Guard: Prisma cannot see raw-SQL indexes on Unsupported() columns and emits a
-- DROP for the pgvector index on every migration. Recreate it if that happened.
CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_idx"
    ON "DocumentChunk" USING hnsw ("embedding" vector_cosine_ops);
