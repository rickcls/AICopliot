-- ScopePilot core: auditable AI proposals, official-record isolation,
-- milestone links, completion timestamps, and mixed-grounding metadata.
--
-- The pgvector column and HNSW index are not represented by Prisma. This
-- migration therefore finishes with an idempotent guard for the index.

-- CreateEnum
CREATE TYPE "CitationPurpose" AS ENUM ('proposal', 'milestone_link');

-- CreateEnum
CREATE TYPE "GroundingScope" AS ENUM ('documents', 'project_combined');

-- AlterEnum
ALTER TYPE "GenerationRunStatus" ADD VALUE 'processing' BEFORE 'draft';

-- Chat and evaluation grounding scope
ALTER TABLE "ChatConversation"
    ADD COLUMN "groundingScope" "GroundingScope" NOT NULL DEFAULT 'documents';

ALTER TABLE "EvaluationCase"
    ADD COLUMN "groundingScope" "GroundingScope" NOT NULL DEFAULT 'documents';

ALTER TABLE "ChatMessage"
    ADD COLUMN "groundingSourceIds" JSONB;

-- Audited tasks and milestone association
ALTER TABLE "Task"
    ADD COLUMN "milestoneId" TEXT,
    ADD COLUMN "completedAt" TIMESTAMP(3),
    ADD COLUMN "generationRunId" TEXT,
    ADD COLUMN "reviewedAt" TIMESTAMP(3),
    ADD COLUMN "reviewedById" TEXT;

-- Audited milestones
ALTER TABLE "Milestone"
    ADD COLUMN "completedAt" TIMESTAMP(3),
    ADD COLUMN "generationRunId" TEXT,
    ADD COLUMN "reviewedAt" TIMESTAMP(3),
    ADD COLUMN "reviewedById" TEXT;

-- Audited risks and milestone association
ALTER TABLE "ProjectRisk"
    ADD COLUMN "milestoneId" TEXT,
    ADD COLUMN "generationRunId" TEXT,
    ADD COLUMN "reviewedAt" TIMESTAMP(3),
    ADD COLUMN "reviewedById" TEXT;

-- Dependencies are proposals in their own right. Defaults make every existing
-- dependency an official manual record.
ALTER TABLE "TaskDependency"
    ADD COLUMN "source" "RecordSource" NOT NULL DEFAULT 'manual',
    ADD COLUMN "generationStatus" "GenerationStatus" NOT NULL DEFAULT 'not_applicable',
    ADD COLUMN "generationRunId" TEXT,
    ADD COLUMN "reviewedAt" TIMESTAMP(3),
    ADD COLUMN "reviewedById" TEXT,
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- @updatedAt is application-managed. The temporary default was needed only to
-- populate existing rows while adding the non-null column.
ALTER TABLE "TaskDependency" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- Preserve when existing completed work actually entered its terminal state as
-- closely as the previous schema permits.
UPDATE "Task"
SET "completedAt" = "updatedAt"
WHERE "status" = 'done' AND "completedAt" IS NULL;

UPDATE "Milestone"
SET "completedAt" = "updatedAt"
WHERE "status" = 'completed' AND "completedAt" IS NULL;

-- Citation purpose lets a source independently support the proposal itself and
-- its association with a milestone.
ALTER TABLE "TaskCitation"
    ADD COLUMN "purpose" "CitationPurpose" NOT NULL DEFAULT 'proposal';

ALTER TABLE "RiskCitation"
    ADD COLUMN "purpose" "CitationPurpose" NOT NULL DEFAULT 'proposal';

DROP INDEX "TaskCitation_taskId_documentChunkId_key";
DROP INDEX "RiskCitation_riskId_documentChunkId_key";

CREATE UNIQUE INDEX "TaskCitation_taskId_documentChunkId_purpose_key"
    ON "TaskCitation"("taskId", "documentChunkId", "purpose");

CREATE UNIQUE INDEX "RiskCitation_riskId_documentChunkId_purpose_key"
    ON "RiskCitation"("riskId", "documentChunkId", "purpose");

-- Evidence for generated dependency edges
CREATE TABLE "TaskDependencyCitation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskDependencyId" TEXT NOT NULL,
    "documentChunkId" TEXT NOT NULL,
    "excerpt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskDependencyCitation_pkey" PRIMARY KEY ("id")
);

-- Generation-run observability
ALTER TABLE "GenerationRun"
    ADD COLUMN "errorMessage" TEXT,
    ADD COLUMN "latencyMs" INTEGER;

-- Indexes
CREATE INDEX "Task_workspaceId_projectId_milestoneId_idx"
    ON "Task"("workspaceId", "projectId", "milestoneId");
CREATE INDEX "Task_workspaceId_completedAt_idx"
    ON "Task"("workspaceId", "completedAt");
CREATE INDEX "Task_generationRunId_idx" ON "Task"("generationRunId");
CREATE INDEX "Task_reviewedById_idx" ON "Task"("reviewedById");

CREATE INDEX "Milestone_generationRunId_idx" ON "Milestone"("generationRunId");
CREATE INDEX "Milestone_reviewedById_idx" ON "Milestone"("reviewedById");
CREATE INDEX "Milestone_workspaceId_completedAt_idx"
    ON "Milestone"("workspaceId", "completedAt");

CREATE INDEX "ProjectRisk_workspaceId_projectId_milestoneId_idx"
    ON "ProjectRisk"("workspaceId", "projectId", "milestoneId");
CREATE INDEX "ProjectRisk_generationRunId_idx" ON "ProjectRisk"("generationRunId");
CREATE INDEX "ProjectRisk_reviewedById_idx" ON "ProjectRisk"("reviewedById");

CREATE INDEX "TaskDependency_generationRunId_idx"
    ON "TaskDependency"("generationRunId");
CREATE INDEX "TaskDependency_reviewedById_idx"
    ON "TaskDependency"("reviewedById");

CREATE INDEX "TaskDependencyCitation_workspaceId_idx"
    ON "TaskDependencyCitation"("workspaceId");
CREATE INDEX "TaskDependencyCitation_documentChunkId_idx"
    ON "TaskDependencyCitation"("documentChunkId");
CREATE UNIQUE INDEX "TaskDependencyCitation_taskDependencyId_documentChunkId_key"
    ON "TaskDependencyCitation"("taskDependencyId", "documentChunkId");

-- Only one plan can be processing or awaiting review for a project. Enum
-- equality is immutable and therefore valid in a partial-index predicate.
CREATE UNIQUE INDEX "GenerationRun_one_active_project_plan_per_project"
    ON "GenerationRun"("projectId")
    WHERE "type" = 'project_plan'
      AND "status" IN ('processing', 'draft');

-- Foreign keys. Generated records retain their approved project value if a run
-- or reviewer is later removed, hence SET NULL.
ALTER TABLE "Task"
    ADD CONSTRAINT "Task_milestoneId_fkey"
        FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "Task_generationRunId_fkey"
        FOREIGN KEY ("generationRunId") REFERENCES "GenerationRun"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "Task_reviewedById_fkey"
        FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Milestone"
    ADD CONSTRAINT "Milestone_generationRunId_fkey"
        FOREIGN KEY ("generationRunId") REFERENCES "GenerationRun"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "Milestone_reviewedById_fkey"
        FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProjectRisk"
    ADD CONSTRAINT "ProjectRisk_milestoneId_fkey"
        FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "ProjectRisk_generationRunId_fkey"
        FOREIGN KEY ("generationRunId") REFERENCES "GenerationRun"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "ProjectRisk_reviewedById_fkey"
        FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TaskDependency"
    ADD CONSTRAINT "TaskDependency_generationRunId_fkey"
        FOREIGN KEY ("generationRunId") REFERENCES "GenerationRun"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "TaskDependency_reviewedById_fkey"
        FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TaskDependencyCitation"
    ADD CONSTRAINT "TaskDependencyCitation_workspaceId_fkey"
        FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "TaskDependencyCitation_taskDependencyId_fkey"
        FOREIGN KEY ("taskDependencyId") REFERENCES "TaskDependency"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "TaskDependencyCitation_documentChunkId_fkey"
        FOREIGN KEY ("documentChunkId") REFERENCES "DocumentChunk"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

-- Source/review-state invariants. generationRunId intentionally is not required
-- by the CHECK for AI rows because the specified SET NULL lifecycle must remain
-- possible when an audit run is deleted. Application writes still require it.
ALTER TABLE "Task"
    ADD CONSTRAINT "Task_source_generation_status_valid"
    CHECK (
      ("source" = 'manual' AND "generationStatus" = 'not_applicable' AND "generationRunId" IS NULL)
      OR
      ("source" = 'ai_suggested' AND "generationStatus" IN ('draft', 'approved', 'rejected'))
    );

ALTER TABLE "Milestone"
    ADD CONSTRAINT "Milestone_source_generation_status_valid"
    CHECK (
      ("source" = 'manual' AND "generationStatus" = 'not_applicable' AND "generationRunId" IS NULL)
      OR
      ("source" = 'ai_suggested' AND "generationStatus" IN ('draft', 'approved', 'rejected'))
    );

ALTER TABLE "ProjectRisk"
    ADD CONSTRAINT "ProjectRisk_source_generation_status_valid"
    CHECK (
      ("source" = 'manual' AND "generationStatus" = 'not_applicable' AND "generationRunId" IS NULL)
      OR
      ("source" = 'ai_suggested' AND "generationStatus" IN ('draft', 'approved', 'rejected'))
    );

ALTER TABLE "TaskDependency"
    ADD CONSTRAINT "TaskDependency_source_generation_status_valid"
    CHECK (
      ("source" = 'manual' AND "generationStatus" = 'not_applicable' AND "generationRunId" IS NULL)
      OR
      ("source" = 'ai_suggested' AND "generationStatus" IN ('draft', 'approved', 'rejected'))
    );

-- Prisma cannot model indexes over Unsupported("vector") fields. Keep the
-- cosine HNSW index present even if a generated migration attempted to drop it.
CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_idx"
    ON "DocumentChunk" USING hnsw ("embedding" vector_cosine_ops);
