-- Task comments: human discussion attached to a task.
--
-- Deliberately outside the source/generationStatus model the delivery records
-- share. A comment is not a proposal awaiting review, so it has no draft state,
-- no reviewer, and never enters officialRecordWhere().
--
-- "workspaceId" is denormalised onto the row, as it is on every other table
-- here, so a read or write can be scoped by workspace directly rather than by
-- joining through the task.
--
-- Written by hand rather than generated: `prisma migrate dev` cannot see the
-- raw-SQL HNSW index on DocumentChunk.embedding and emits a DROP INDEX for it
-- in every migration it produces.

-- CreateTable
CREATE TABLE "TaskComment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskComment_workspaceId_taskId_createdAt_idx" ON "TaskComment"("workspaceId", "taskId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskComment_authorId_idx" ON "TaskComment"("authorId");

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A comment on a deleted task is unreachable in every view, so it goes with it.
-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Removing a person leaves their comments in place, attributed to nobody,
-- rather than silently deleting a thread other people replied to.
-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
