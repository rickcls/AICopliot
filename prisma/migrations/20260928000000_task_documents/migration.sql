-- CreateTable: a task's working documents. A link to an ordinary project
-- document rather than a second attachment store, so the file stays indexed
-- for chat, extraction, and the task AI fill.
CREATE TABLE "TaskDocument" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskDocument_workspaceId_idx" ON "TaskDocument"("workspaceId");

-- CreateIndex
CREATE INDEX "TaskDocument_documentId_idx" ON "TaskDocument"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskDocument_taskId_documentId_key" ON "TaskDocument"("taskId", "documentId");

-- AddForeignKey
ALTER TABLE "TaskDocument" ADD CONSTRAINT "TaskDocument_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDocument" ADD CONSTRAINT "TaskDocument_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDocument" ADD CONSTRAINT "TaskDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Guard: Prisma cannot see raw-SQL indexes on Unsupported() columns and emits a
-- DROP for the pgvector index on every migration. Recreate it if that happened.
CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_idx"
    ON "DocumentChunk" USING hnsw ("embedding" vector_cosine_ops);
