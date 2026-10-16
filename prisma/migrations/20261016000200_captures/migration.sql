-- Captures: what a person tells the assistant (private to them), and the
-- changes it proposes. CREATE TYPE with its first use is fine in one file;
-- only ALTER TYPE ... ADD VALUE needs a file of its own.

-- CreateEnum
CREATE TYPE "CaptureSource" AS ENUM ('text', 'voice', 'document', 'email');

-- CreateEnum
CREATE TYPE "CaptureStatus" AS ENUM ('processing', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "CaptureProposalKind" AS ENUM ('create_task', 'update_task', 'add_note');

-- CreateEnum
CREATE TYPE "CaptureProposalState" AS ENUM ('pending', 'applied', 'dismissed');

-- CreateTable
CREATE TABLE "Capture" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "CaptureSource" NOT NULL DEFAULT 'text',
    "body" TEXT NOT NULL,
    "localDate" DATE NOT NULL,
    "timeZone" TEXT NOT NULL,
    "replyLanguage" TEXT NOT NULL,
    "documentId" TEXT,
    "externalId" TEXT,
    "status" "CaptureStatus" NOT NULL DEFAULT 'processing',
    "errorMessage" TEXT,
    "modelName" TEXT,
    "promptVersion" TEXT,
    "rawOutput" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Capture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureProposal" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "captureId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "CaptureProposalKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "citations" JSONB NOT NULL,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "taskId" TEXT,
    "state" "CaptureProposalState" NOT NULL DEFAULT 'pending',
    "decidedAt" TIMESTAMP(3),
    "appliedTaskId" TEXT,
    "appliedCommentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaptureProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Capture_workspaceId_userId_createdAt_idx" ON "Capture"("workspaceId", "userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Capture_userId_externalId_key" ON "Capture"("userId", "externalId");

-- CreateIndex
CREATE INDEX "CaptureProposal_workspaceId_userId_state_idx" ON "CaptureProposal"("workspaceId", "userId", "state");

-- CreateIndex
CREATE INDEX "CaptureProposal_captureId_position_idx" ON "CaptureProposal"("captureId", "position");

-- AddForeignKey
ALTER TABLE "Capture" ADD CONSTRAINT "Capture_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Capture" ADD CONSTRAINT "Capture_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Capture" ADD CONSTRAINT "Capture_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureProposal" ADD CONSTRAINT "CaptureProposal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureProposal" ADD CONSTRAINT "CaptureProposal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureProposal" ADD CONSTRAINT "CaptureProposal_captureId_fkey" FOREIGN KEY ("captureId") REFERENCES "Capture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureProposal" ADD CONSTRAINT "CaptureProposal_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureProposal" ADD CONSTRAINT "CaptureProposal_appliedTaskId_fkey" FOREIGN KEY ("appliedTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureProposal" ADD CONSTRAINT "CaptureProposal_appliedCommentId_fkey" FOREIGN KEY ("appliedCommentId") REFERENCES "TaskComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Guard: Prisma cannot see raw-SQL indexes on Unsupported() columns and emits a
-- DROP for the pgvector index on every migration. Recreate it if that happened.
CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_idx"
    ON "DocumentChunk" USING hnsw ("embedding" vector_cosine_ops);
