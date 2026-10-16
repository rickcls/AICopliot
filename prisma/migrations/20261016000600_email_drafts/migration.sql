-- Email drafts in the person's own tone: their writing samples and derived
-- profile, and the drafts they keep. Nothing here is ever sent by the app.

-- CreateTable
CREATE TABLE "WritingStyle" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "samples" JSONB NOT NULL DEFAULT '[]',
    "profile" TEXT,
    "signature" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WritingStyle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDraft" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT,
    "purpose" TEXT NOT NULL,
    "recipient" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "flags" JSONB NOT NULL DEFAULT '[]',
    "language" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WritingStyle_userId_key" ON "WritingStyle"("userId");

-- CreateIndex
CREATE INDEX "EmailDraft_workspaceId_userId_createdAt_idx" ON "EmailDraft"("workspaceId", "userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "WritingStyle" ADD CONSTRAINT "WritingStyle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDraft" ADD CONSTRAINT "EmailDraft_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDraft" ADD CONSTRAINT "EmailDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDraft" ADD CONSTRAINT "EmailDraft_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Guard: Prisma cannot see raw-SQL indexes on Unsupported() columns and emits a
-- DROP for the pgvector index on every migration. Recreate it if that happened.
CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_idx"
    ON "DocumentChunk" USING hnsw ("embedding" vector_cosine_ops);
