-- Filing labels for documents: an AI- or person-written title, summary, type,
-- tags, and a suggested project for documents filed in the wrong place.

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "docType" TEXT,
ADD COLUMN     "labelSource" TEXT,
ADD COLUMN     "labelledAt" TIMESTAMP(3),
ADD COLUMN     "suggestedProjectId" TEXT,
ADD COLUMN     "summary" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "title" TEXT;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_suggestedProjectId_fkey" FOREIGN KEY ("suggestedProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Guard: Prisma cannot see raw-SQL indexes on Unsupported() columns and emits a
-- DROP for the pgvector index on every migration. Recreate it if that happened.
CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_idx"
    ON "DocumentChunk" USING hnsw ("embedding" vector_cosine_ops);
