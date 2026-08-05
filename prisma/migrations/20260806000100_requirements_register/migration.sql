-- Requirement register: cited, human-validated requirements with their own
-- discovery lifecycle, plus traceability edges to delivery records.
--
-- Two status axes live on "Requirement" and they are not interchangeable:
--   source + generationStatus — did a human accept this record? (same CHECK as
--     Task/Milestone/ProjectRisk, so officialRecordWhere() applies unchanged)
--   status                    — is this agreed scope? Only 'approved' is baselined.
--
-- The pgvector column and HNSW index are not represented by Prisma, so this
-- migration finishes with an idempotent guard for the index.

-- CreateEnum
CREATE TYPE "RequirementType" AS ENUM ('business', 'functional', 'non_functional', 'constraint');

-- CreateEnum
CREATE TYPE "RequirementPriority" AS ENUM ('must', 'should', 'could', 'wont');

-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('draft', 'needs_clarification', 'validated', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "RequirementConfidence" AS ENUM ('high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "RequirementLinkTarget" AS ENUM ('task', 'milestone', 'risk');

-- CreateTable
CREATE TABLE "Requirement" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "RequirementType" NOT NULL DEFAULT 'functional',
    "priority" "RequirementPriority" NOT NULL DEFAULT 'should',
    "status" "RequirementStatus" NOT NULL DEFAULT 'draft',
    "acceptanceCriteria" TEXT,
    "assumptions" TEXT,
    "confidence" "RequirementConfidence" NOT NULL DEFAULT 'medium',
    "stakeholder" TEXT,
    "source" "RecordSource" NOT NULL DEFAULT 'manual',
    "generationStatus" "GenerationStatus" NOT NULL DEFAULT 'not_applicable',
    "generationRunId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "targetType" "RequirementLinkTarget" NOT NULL,
    "taskId" TEXT,
    "milestoneId" TEXT,
    "riskId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementCitation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "documentChunkId" TEXT NOT NULL,
    "excerpt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementCitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Requirement_projectId_sequence_key" ON "Requirement"("projectId", "sequence");

-- CreateIndex
CREATE INDEX "Requirement_workspaceId_projectId_status_idx" ON "Requirement"("workspaceId", "projectId", "status");

-- CreateIndex
CREATE INDEX "Requirement_workspaceId_projectId_priority_idx" ON "Requirement"("workspaceId", "projectId", "priority");

-- CreateIndex
CREATE INDEX "Requirement_generationRunId_idx" ON "Requirement"("generationRunId");

-- CreateIndex
CREATE INDEX "Requirement_reviewedById_idx" ON "Requirement"("reviewedById");

-- CreateIndex. NULLs compare as distinct, so each unique constraint only binds
-- the rows that actually target that kind of record.
CREATE UNIQUE INDEX "RequirementLink_requirementId_taskId_key" ON "RequirementLink"("requirementId", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementLink_requirementId_milestoneId_key" ON "RequirementLink"("requirementId", "milestoneId");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementLink_requirementId_riskId_key" ON "RequirementLink"("requirementId", "riskId");

-- CreateIndex
CREATE INDEX "RequirementLink_workspaceId_requirementId_idx" ON "RequirementLink"("workspaceId", "requirementId");

-- CreateIndex
CREATE INDEX "RequirementLink_taskId_idx" ON "RequirementLink"("taskId");

-- CreateIndex
CREATE INDEX "RequirementLink_milestoneId_idx" ON "RequirementLink"("milestoneId");

-- CreateIndex
CREATE INDEX "RequirementLink_riskId_idx" ON "RequirementLink"("riskId");

-- CreateIndex
CREATE INDEX "RequirementLink_createdById_idx" ON "RequirementLink"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementCitation_requirementId_documentChunkId_key" ON "RequirementCitation"("requirementId", "documentChunkId");

-- CreateIndex
CREATE INDEX "RequirementCitation_workspaceId_idx" ON "RequirementCitation"("workspaceId");

-- CreateIndex
CREATE INDEX "RequirementCitation_documentChunkId_idx" ON "RequirementCitation"("documentChunkId");

-- AddForeignKey
ALTER TABLE "Requirement"
    ADD CONSTRAINT "Requirement_workspaceId_fkey"
        FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey. Requirements cannot exist without a project, so they cascade
-- rather than surviving unassigned the way documents do.
ALTER TABLE "Requirement"
    ADD CONSTRAINT "Requirement_projectId_fkey"
        FOREIGN KEY ("projectId") REFERENCES "Project"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement"
    ADD CONSTRAINT "Requirement_generationRunId_fkey"
        FOREIGN KEY ("generationRunId") REFERENCES "GenerationRun"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement"
    ADD CONSTRAINT "Requirement_reviewedById_fkey"
        FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementLink"
    ADD CONSTRAINT "RequirementLink_workspaceId_fkey"
        FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementLink"
    ADD CONSTRAINT "RequirementLink_requirementId_fkey"
        FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementLink"
    ADD CONSTRAINT "RequirementLink_taskId_fkey"
        FOREIGN KEY ("taskId") REFERENCES "Task"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementLink"
    ADD CONSTRAINT "RequirementLink_milestoneId_fkey"
        FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementLink"
    ADD CONSTRAINT "RequirementLink_riskId_fkey"
        FOREIGN KEY ("riskId") REFERENCES "ProjectRisk"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementLink"
    ADD CONSTRAINT "RequirementLink_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "User"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementCitation"
    ADD CONSTRAINT "RequirementCitation_workspaceId_fkey"
        FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementCitation"
    ADD CONSTRAINT "RequirementCitation_requirementId_fkey"
        FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementCitation"
    ADD CONSTRAINT "RequirementCitation_documentChunkId_fkey"
        FOREIGN KEY ("documentChunkId") REFERENCES "DocumentChunk"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

-- Source/review-state invariant, identical to Task/Milestone/ProjectRisk.
-- generationRunId is intentionally not required for AI rows because the
-- SET NULL lifecycle must remain possible when an audit run is deleted.
ALTER TABLE "Requirement"
    ADD CONSTRAINT "Requirement_source_generation_status_valid"
    CHECK (
      ("source" = 'manual' AND "generationStatus" = 'not_applicable' AND "generationRunId" IS NULL)
      OR
      ("source" = 'ai_suggested' AND "generationStatus" IN ('draft', 'approved', 'rejected'))
    );

-- A link must point at exactly one record, and at the kind it claims to.
-- Without this the discriminator and the foreign keys could disagree, and a
-- coverage query would count an edge that leads nowhere.
ALTER TABLE "RequirementLink"
    ADD CONSTRAINT "RequirementLink_exactly_one_target"
    CHECK (
      ("targetType" = 'task' AND "taskId" IS NOT NULL AND "milestoneId" IS NULL AND "riskId" IS NULL)
      OR
      ("targetType" = 'milestone' AND "milestoneId" IS NOT NULL AND "taskId" IS NULL AND "riskId" IS NULL)
      OR
      ("targetType" = 'risk' AND "riskId" IS NOT NULL AND "taskId" IS NULL AND "milestoneId" IS NULL)
    );

-- One extraction run at a time per project, mirroring the project_plan guard.
-- Concurrent runs would interleave draft rows from two evidence sets in one
-- register with no way to tell them apart during review.
CREATE UNIQUE INDEX "GenerationRun_one_active_requirements_run_per_project"
    ON "GenerationRun"("projectId")
    WHERE "type" = 'requirements' AND "status" IN ('processing', 'draft');

-- Prisma cannot model indexes over Unsupported("vector") fields. Keep the
-- cosine HNSW index present even if a generated migration attempted to drop it.
CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_idx"
    ON "DocumentChunk" USING hnsw ("embedding" vector_cosine_ops);
