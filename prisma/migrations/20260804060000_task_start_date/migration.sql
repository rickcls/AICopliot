-- A Gantt bar needs a duration, not just a deadline. Nullable, so every
-- existing task keeps working and renders as a single-day marker until a start
-- date is set.
ALTER TABLE "Task" ADD COLUMN "startDate" TIMESTAMP(3);

-- Supports ordering the Gantt rows by when work begins.
CREATE INDEX "Task_workspaceId_startDate_idx" ON "Task"("workspaceId", "startDate");
