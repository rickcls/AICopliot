-- CreateEnum: what a thread is narrowed to inside its grounding scope. A new
-- type (not ADD VALUE on an existing one), so it may be used in this same
-- migration.
CREATE TYPE "ChatFocus" AS ENUM ('none', 'task', 'documents');

-- AlterTable
ALTER TABLE "ChatConversation" ADD COLUMN     "focus" "ChatFocus" NOT NULL DEFAULT 'none',
ADD COLUMN     "focusDocumentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "taskId" TEXT;

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "proposals" JSONB;

-- CreateIndex
CREATE INDEX "ChatConversation_taskId_idx" ON "ChatConversation"("taskId");

-- AddForeignKey
ALTER TABLE "ChatConversation" ADD CONSTRAINT "ChatConversation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Guard: Prisma cannot see raw-SQL indexes on Unsupported() columns and emits a
-- DROP for the pgvector index on every migration. Recreate it if that happened.
CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_idx"
    ON "DocumentChunk" USING hnsw ("embedding" vector_cosine_ops);
