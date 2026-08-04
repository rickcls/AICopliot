-- Project management layer: tasks, dependencies, milestones, risks, and the
-- citation/audit tables reserved for document-grounded generation.
--
-- Additive only. No existing column, index, enum, or foreign key is altered, and
-- neither the vector(1536) column nor its HNSW index is touched.

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('backlog', 'todo', 'in_progress', 'blocked', 'done');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('low', 'medium', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('not_started', 'on_track', 'at_risk', 'blocked', 'completed');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "RiskStatus" AS ENUM ('open', 'monitoring', 'mitigated', 'accepted');

-- CreateEnum
CREATE TYPE "RecordSource" AS ENUM ('manual', 'ai_suggested');

-- CreateEnum
CREATE TYPE "GenerationStatus" AS ENUM ('not_applicable', 'draft', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "GenerationRunType" AS ENUM ('project_plan', 'tasks', 'status_report');

-- CreateEnum
CREATE TYPE "GenerationRunStatus" AS ENUM ('draft', 'approved', 'partially_approved', 'rejected', 'failed');

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'backlog',
    "priority" "TaskPriority" NOT NULL DEFAULT 'medium',
    "assigneeId" TEXT,
    "estimatedHours" DOUBLE PRECISION,
    "dueDate" TIMESTAMP(3),
    "source" "RecordSource" NOT NULL DEFAULT 'manual',
    "generationStatus" "GenerationStatus" NOT NULL DEFAULT 'not_applicable',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskDependency" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "dependsOnTaskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "targetDate" TIMESTAMP(3),
    "status" "MilestoneStatus" NOT NULL DEFAULT 'not_started',
    "source" "RecordSource" NOT NULL DEFAULT 'manual',
    "generationStatus" "GenerationStatus" NOT NULL DEFAULT 'not_applicable',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectRisk" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "impact" "RiskLevel" NOT NULL DEFAULT 'medium',
    "likelihood" "RiskLevel" NOT NULL DEFAULT 'medium',
    "mitigation" TEXT,
    "status" "RiskStatus" NOT NULL DEFAULT 'open',
    "source" "RecordSource" NOT NULL DEFAULT 'manual',
    "generationStatus" "GenerationStatus" NOT NULL DEFAULT 'not_applicable',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectRisk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskCitation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "documentChunkId" TEXT NOT NULL,
    "excerpt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskCitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MilestoneCitation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "documentChunkId" TEXT NOT NULL,
    "excerpt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MilestoneCitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskCitation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "documentChunkId" TEXT NOT NULL,
    "excerpt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskCitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "GenerationRunType" NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "selectedContextIds" JSONB NOT NULL,
    "rawOutput" TEXT,
    "validatedOutput" JSONB,
    "status" "GenerationRunStatus" NOT NULL DEFAULT 'draft',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "GenerationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Task_workspaceId_projectId_status_idx" ON "Task"("workspaceId", "projectId", "status");

-- CreateIndex
CREATE INDEX "Task_workspaceId_dueDate_idx" ON "Task"("workspaceId", "dueDate");

-- CreateIndex
CREATE INDEX "Task_assigneeId_idx" ON "Task"("assigneeId");

-- CreateIndex
CREATE INDEX "TaskDependency_workspaceId_idx" ON "TaskDependency"("workspaceId");

-- CreateIndex
CREATE INDEX "TaskDependency_dependsOnTaskId_idx" ON "TaskDependency"("dependsOnTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskDependency_taskId_dependsOnTaskId_key" ON "TaskDependency"("taskId", "dependsOnTaskId");

-- CreateIndex
CREATE INDEX "Milestone_workspaceId_projectId_idx" ON "Milestone"("workspaceId", "projectId");

-- CreateIndex
CREATE INDEX "Milestone_workspaceId_targetDate_idx" ON "Milestone"("workspaceId", "targetDate");

-- CreateIndex
CREATE INDEX "ProjectRisk_workspaceId_projectId_status_idx" ON "ProjectRisk"("workspaceId", "projectId", "status");

-- CreateIndex
CREATE INDEX "TaskCitation_workspaceId_idx" ON "TaskCitation"("workspaceId");

-- CreateIndex
CREATE INDEX "TaskCitation_documentChunkId_idx" ON "TaskCitation"("documentChunkId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskCitation_taskId_documentChunkId_key" ON "TaskCitation"("taskId", "documentChunkId");

-- CreateIndex
CREATE INDEX "MilestoneCitation_workspaceId_idx" ON "MilestoneCitation"("workspaceId");

-- CreateIndex
CREATE INDEX "MilestoneCitation_documentChunkId_idx" ON "MilestoneCitation"("documentChunkId");

-- CreateIndex
CREATE UNIQUE INDEX "MilestoneCitation_milestoneId_documentChunkId_key" ON "MilestoneCitation"("milestoneId", "documentChunkId");

-- CreateIndex
CREATE INDEX "RiskCitation_workspaceId_idx" ON "RiskCitation"("workspaceId");

-- CreateIndex
CREATE INDEX "RiskCitation_documentChunkId_idx" ON "RiskCitation"("documentChunkId");

-- CreateIndex
CREATE UNIQUE INDEX "RiskCitation_riskId_documentChunkId_key" ON "RiskCitation"("riskId", "documentChunkId");

-- CreateIndex
CREATE INDEX "GenerationRun_workspaceId_projectId_createdAt_idx" ON "GenerationRun"("workspaceId", "projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_dependsOnTaskId_fkey" FOREIGN KEY ("dependsOnTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRisk" ADD CONSTRAINT "ProjectRisk_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRisk" ADD CONSTRAINT "ProjectRisk_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCitation" ADD CONSTRAINT "TaskCitation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCitation" ADD CONSTRAINT "TaskCitation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCitation" ADD CONSTRAINT "TaskCitation_documentChunkId_fkey" FOREIGN KEY ("documentChunkId") REFERENCES "DocumentChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneCitation" ADD CONSTRAINT "MilestoneCitation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneCitation" ADD CONSTRAINT "MilestoneCitation_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneCitation" ADD CONSTRAINT "MilestoneCitation_documentChunkId_fkey" FOREIGN KEY ("documentChunkId") REFERENCES "DocumentChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskCitation" ADD CONSTRAINT "RiskCitation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskCitation" ADD CONSTRAINT "RiskCitation_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "ProjectRisk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskCitation" ADD CONSTRAINT "RiskCitation_documentChunkId_fkey" FOREIGN KEY ("documentChunkId") REFERENCES "DocumentChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationRun" ADD CONSTRAINT "GenerationRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationRun" ADD CONSTRAINT "GenerationRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationRun" ADD CONSTRAINT "GenerationRun_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A task depending on itself is meaningless and would make any future ordering
-- calculation non-terminating. Prisma has no schema syntax for CHECK, so this is
-- declared here — the same reason the HNSW and GIN indexes are hand-written.
-- The API rejects it first; this is the guarantee that survives a code mistake.
ALTER TABLE "TaskDependency"
    ADD CONSTRAINT "TaskDependency_no_self_reference"
    CHECK ("taskId" <> "dependsOnTaskId");
