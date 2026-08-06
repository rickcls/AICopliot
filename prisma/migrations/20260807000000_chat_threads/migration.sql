-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "refused" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ChatConversation" ADD COLUMN     "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill: order existing threads by their newest turn, falling back to the
-- conversation's own creation for a thread whose answer never landed.
UPDATE "ChatConversation" c
SET "lastMessageAt" = COALESCE(
  (SELECT MAX(m."createdAt") FROM "ChatMessage" m WHERE m."conversationId" = c."id"),
  c."createdAt"
);

-- Backfill: for rows written before this column existed, a low-confidence answer
-- with no citations is a refusal by the citation-validation guard. `citations`
-- is JSONB, so both the SQL NULL and the empty array have to be matched.
UPDATE "ChatMessage"
SET "refused" = true
WHERE "role" = 'assistant'
  AND "confidence" = 'low'
  AND ("citations" IS NULL OR "citations" = '[]'::jsonb);

-- CreateIndex
CREATE INDEX "ChatConversation_workspaceId_userId_lastMessageAt_idx"
    ON "ChatConversation"("workspaceId", "userId", "lastMessageAt" DESC);

-- Guard: Prisma cannot see raw-SQL indexes on Unsupported() columns and emits a
-- DROP for the pgvector index on every migration. Recreate it if that happened.
CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_idx"
    ON "DocumentChunk" USING hnsw ("embedding" vector_cosine_ops);
