CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Document" ADD COLUMN "projectId" TEXT;
ALTER TABLE "ChatConversation" ADD COLUMN "projectId" TEXT;
ALTER TABLE "EvaluationCase" ADD COLUMN "projectId" TEXT;

CREATE UNIQUE INDEX "Project_workspaceId_name_key"
    ON "Project"("workspaceId", "name");
CREATE INDEX "Project_workspaceId_createdAt_idx"
    ON "Project"("workspaceId", "createdAt");
CREATE INDEX "Document_workspaceId_projectId_idx"
    ON "Document"("workspaceId", "projectId");
CREATE INDEX "EvaluationCase_workspaceId_projectId_idx"
    ON "EvaluationCase"("workspaceId", "projectId");

ALTER TABLE "Project"
    ADD CONSTRAINT "Project_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Document"
    ADD CONSTRAINT "Document_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ChatConversation"
    ADD CONSTRAINT "ChatConversation_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EvaluationCase"
    ADD CONSTRAINT "EvaluationCase_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
