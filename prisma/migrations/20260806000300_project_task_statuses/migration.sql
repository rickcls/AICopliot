-- Project-scoped task statuses.
--
-- Replaces the global TaskStatus enum with per-project columns. Semantics
-- (open / blocked / done) live on TaskStatusCategory so overdue, completion
-- timestamps, blockers, and reports keep one definition while labels and keys
-- become configurable.
--
-- Written by hand rather than generated: `prisma migrate dev` cannot see the
-- raw-SQL HNSW index on DocumentChunk.embedding and emits a DROP INDEX for it
-- in every migration it produces.

-- CreateEnum
CREATE TYPE "TaskStatusCategory" AS ENUM ('open', 'blocked', 'done');

-- CreateTable
CREATE TABLE "ProjectTaskStatus" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" "TaskStatusCategory" NOT NULL,
    "position" INTEGER NOT NULL,
    "color" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectTaskStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTaskStatus_projectId_key_key" ON "ProjectTaskStatus"("projectId", "key");

-- CreateIndex
CREATE INDEX "ProjectTaskStatus_workspaceId_projectId_position_idx" ON "ProjectTaskStatus"("workspaceId", "projectId", "position");

-- AddForeignKey
ALTER TABLE "ProjectTaskStatus" ADD CONSTRAINT "ProjectTaskStatus_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskStatus" ADD CONSTRAINT "ProjectTaskStatus_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the classic five columns on every existing project.
DO $$
DECLARE
  proj RECORD;
BEGIN
  FOR proj IN SELECT "id", "workspaceId" FROM "Project" LOOP
    INSERT INTO "ProjectTaskStatus"
      ("id", "workspaceId", "projectId", "key", "label", "category", "position", "color", "isDefault", "createdAt", "updatedAt")
    VALUES
      ('pts_' || replace(gen_random_uuid()::text, '-', ''), proj."workspaceId", proj."id", 'backlog', 'Backlog', 'open', 0, 'slate', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('pts_' || replace(gen_random_uuid()::text, '-', ''), proj."workspaceId", proj."id", 'todo', 'To do', 'open', 1, 'blue', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('pts_' || replace(gen_random_uuid()::text, '-', ''), proj."workspaceId", proj."id", 'in_progress', 'In progress', 'open', 2, 'amber', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('pts_' || replace(gen_random_uuid()::text, '-', ''), proj."workspaceId", proj."id", 'blocked', 'Blocked', 'blocked', 3, 'red', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('pts_' || replace(gen_random_uuid()::text, '-', ''), proj."workspaceId", proj."id", 'done', 'Done', 'done', 4, 'emerald', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
  END LOOP;
END $$;

-- Add statusId (nullable for backfill)
ALTER TABLE "Task" ADD COLUMN "statusId" TEXT;

-- Backfill statusId from the seeded rows matching the old enum value.
UPDATE "Task" AS t
SET "statusId" = pts."id"
FROM "ProjectTaskStatus" AS pts
WHERE pts."projectId" = t."projectId"
  AND pts."key" = t."status"::text;

-- Every task must have resolved; refuse the migration if any did not.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Task" WHERE "statusId" IS NULL) THEN
    RAISE EXCEPTION 'Task.statusId backfill left null rows';
  END IF;
END $$;

ALTER TABLE "Task" ALTER COLUMN "statusId" SET NOT NULL;

-- Drop the old enum column and its index before the FK.
DROP INDEX IF EXISTS "Task_workspaceId_projectId_status_idx";
ALTER TABLE "Task" DROP COLUMN "status";
DROP TYPE "TaskStatus";

-- CreateIndex
CREATE INDEX "Task_workspaceId_projectId_statusId_idx" ON "Task"("workspaceId", "projectId", "statusId");

-- CreateIndex
CREATE INDEX "Task_statusId_idx" ON "Task"("statusId");

-- Restrict rather than cascade: deleting a column that still has tasks must fail
-- at the API with a clear message, not silently wipe work.
ALTER TABLE "Task" ADD CONSTRAINT "Task_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "ProjectTaskStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
