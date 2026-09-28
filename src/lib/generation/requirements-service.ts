import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  getChatProvider,
  getEmbeddingProvider,
  type ChatProvider,
  type EmbeddingProvider,
} from "@/lib/providers";
import { buildLabelledContext, selectDocumentContext } from "./context";
import { extractJsonObject } from "./prompt";
import {
  buildRequirementsUserMessage,
  MAX_EXISTING_TITLES,
  REQUIREMENTS_PROMPT_VERSION,
  REQUIREMENTS_QUERIES,
  REQUIREMENTS_SYSTEM_PROMPT,
} from "./requirements-prompt";
import { modelRequirementsSchema } from "./schemas";
import { GenerationRequestError } from "./service";
import { PlanValidationError } from "./validate";
import {
  validateRequirements,
  type ValidatedRequirements,
} from "./requirements-validate";

export interface GenerateRequirementsDeps {
  chat?: ChatProvider;
  embeddings?: EmbeddingProvider;
}

export interface GenerateRequirementsInput {
  workspaceId: string;
  projectId: string;
  userId: string;
  documentIds: string[];
}

type SourceLabel = {
  label: string;
  chunkId: string;
  documentId: string;
  filename: string;
  pageNumber: number | null;
  sectionTitle: string | null;
};

const ACTIVE_RUN_MESSAGE =
  "Review the active draft requirements before extracting more";

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function rawAttempts(attempts: string[]) {
  return attempts.length === 0 ? null : JSON.stringify({ attempts });
}

function parseRequirements(raw: string) {
  let value: unknown;
  try {
    value = JSON.parse(extractJsonObject(raw));
  } catch {
    return null;
  }
  const parsed = modelRequirementsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Extracts cited draft requirements from selected project documents.
 *
 * Structurally identical to generateProjectPlan — an auditable run exists before
 * the provider is resolved, opaque labels stand in for chunk IDs, and only
 * validated proposals are persisted, as drafts a human must review.
 */
export async function generateRequirements(
  input: GenerateRequirementsInput,
  deps: GenerateRequirementsDeps = {},
) {
  const { workspaceId, projectId, userId, documentIds } = input;

  const documents = await prisma.document.findMany({
    where: { id: { in: documentIds }, workspaceId, projectId, status: "ready" },
    select: { id: true },
  });
  if (documents.length !== documentIds.length) {
    throw new GenerationRequestError(
      "Every selected document must be ready and belong to this project",
      400,
    );
  }

  const active = await prisma.generationRun.findFirst({
    where: {
      workspaceId,
      projectId,
      type: "requirements",
      status: { in: ["processing", "draft"] },
    },
    select: { id: true },
  });
  if (active) {
    throw new GenerationRequestError(ACTIVE_RUN_MESSAGE, 409);
  }

  const startedAt = Date.now();
  let run: { id: string };
  try {
    run = await prisma.generationRun.create({
      data: {
        workspaceId,
        projectId,
        type: "requirements",
        // Provider construction happens after this row exists so a missing API
        // configuration is still retained as an auditable failed run.
        model: deps.chat?.modelName ?? "unavailable",
        promptVersion: REQUIREMENTS_PROMPT_VERSION,
        selectedContextIds: jsonValue({ documentIds }),
        status: "processing",
        createdBy: userId,
      },
      select: { id: true },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new GenerationRequestError(ACTIVE_RUN_MESSAGE, 409);
    }
    throw error;
  }

  const attempts: string[] = [];
  let selectedContextIds: Prisma.InputJsonValue = jsonValue({ documentIds });

  try {
    const chat = deps.chat ?? getChatProvider();
    const embeddings = deps.embeddings ?? getEmbeddingProvider();
    await prisma.generationRun.update({
      where: { id: run.id },
      data: { model: chat.modelName },
    });

    const chunks = await selectDocumentContext(
      workspaceId,
      documentIds,
      embeddings,
      REQUIREMENTS_QUERIES,
    );
    if (chunks.length === 0) {
      throw new PlanValidationError(
        "The selected documents do not contain any indexed text",
      );
    }
    const context = buildLabelledContext(chunks);
    selectedContextIds = jsonValue({
      documentIds,
      sourceLabels: context.sourceLabels,
    });

    // Everything already recorded, rejected rows included: a requirement the
    // client turned down should not come back with every new meeting note.
    const existing = await prisma.requirement.findMany({
      where: { workspaceId, projectId },
      orderBy: { sequence: "asc" },
      take: MAX_EXISTING_TITLES,
      select: { title: true, status: true },
    });

    const baseMessages = [
      { role: "system" as const, content: REQUIREMENTS_SYSTEM_PROMPT },
      {
        role: "user" as const,
        content: buildRequirementsUserMessage(
          context.contextBlock,
          existing.map((row) => ({
            title: row.title,
            rejected: row.status === "rejected",
          })),
        ),
      },
    ];

    attempts.push(
      await chat.complete(baseMessages, {
        jsonMode: true,
        temperature: 0,
        maxTokens: 6000,
      }),
    );
    let parsed = parseRequirements(attempts[0]);

    // Exactly one repair attempt, matching the plan flow. The invalid text is
    // retained verbatim in the audit record.
    if (!parsed) {
      attempts.push(
        await chat.complete(
          [
            ...baseMessages,
            { role: "assistant" as const, content: attempts[0] },
            {
              role: "user" as const,
              content:
                "That reply did not match the required JSON contract. Correct it and reply with only one valid JSON object. Do not add requirements unless they are cited to a supplied S label.",
            },
          ],
          { jsonMode: true, temperature: 0, maxTokens: 6000 },
        ),
      );
      parsed = parseRequirements(attempts[1]);
    }

    if (!parsed) {
      throw new PlanValidationError(
        "The model returned malformed requirement data twice",
      );
    }

    const validated = validateRequirements(
      parsed,
      context.sourceMap,
      existing.map((row) => row.title),
    );
    return await persistDraftRequirements({
      workspaceId,
      projectId,
      generationRunId: run.id,
      validated,
      rawOutput: rawAttempts(attempts)!,
      selectedContextIds,
      latencyMs: Date.now() - startedAt,
      sourceLabels: context.sourceLabels,
      model: chat.modelName,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 2000) : "Extraction failed";
    await prisma.generationRun
      .update({
        where: { id: run.id },
        data: {
          status: "failed",
          errorMessage: message,
          latencyMs: Date.now() - startedAt,
          rawOutput: rawAttempts(attempts),
          selectedContextIds,
        },
      })
      .catch(() => undefined);

    if (error instanceof PlanValidationError) {
      throw new GenerationRequestError(error.message, 422);
    }
    throw error;
  }
}

interface PersistDraftRequirementsInput {
  workspaceId: string;
  projectId: string;
  generationRunId: string;
  validated: ValidatedRequirements;
  rawOutput: string;
  selectedContextIds: Prisma.InputJsonValue;
  latencyMs: number;
  sourceLabels: SourceLabel[];
  model: string;
}

async function persistDraftRequirements(input: PersistDraftRequirementsInput) {
  const {
    workspaceId,
    projectId,
    generationRunId,
    validated,
    rawOutput,
    selectedContextIds,
    latencyMs,
    sourceLabels,
    model,
  } = input;

  return prisma.$transaction(
    async (tx) => {
      // Sequences are read inside the transaction and handed out in order, so a
      // batch never collides with itself. The unique index is what stops two
      // concurrent batches colliding with each other.
      const highest = await tx.requirement.aggregate({
        where: { projectId },
        _max: { sequence: true },
      });
      let sequence = highest._max.sequence ?? 0;

      for (const proposal of validated.requirements) {
        sequence += 1;
        await tx.requirement.create({
          data: {
            workspaceId,
            projectId,
            sequence,
            title: proposal.title,
            description: proposal.description,
            type: proposal.type,
            priority: proposal.priority,
            // Both axes start unaccepted: the record is an unreviewed proposal
            // and its content is not agreed scope.
            status: "draft",
            acceptanceCriteria: proposal.acceptanceCriteria,
            assumptions: proposal.assumptions,
            stakeholder: proposal.stakeholder,
            confidence: proposal.confidence,
            source: "ai_suggested",
            generationStatus: "draft",
            generationRunId,
            citations: {
              create: proposal.citations.map((citation) => ({
                workspaceId,
                documentChunkId: citation.chunkId,
                excerpt: citation.excerpt,
              })),
            },
          },
          select: { id: true },
        });
      }

      return tx.generationRun.update({
        where: { id: generationRunId },
        data: {
          status: "draft",
          rawOutput,
          validatedOutput: jsonValue({
            ...validated,
            // Review metadata is safe to expose; the label-to-database-ID map
            // stays exclusively in selectedContextIds on the server.
            sourceLabels: sourceLabels.map(
              ({ label, filename, pageNumber, sectionTitle }) => ({
                label,
                filename,
                pageNumber,
                sectionTitle,
              }),
            ),
          }),
          selectedContextIds,
          latencyMs,
          errorMessage: null,
          model,
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
          latencyMs: true,
          _count: { select: { requirements: true } },
        },
      });
    },
    { timeout: 20_000 },
  );
}

const requirementRunSelect = {
  id: true,
  type: true,
  status: true,
  model: true,
  promptVersion: true,
  errorMessage: true,
  latencyMs: true,
  createdAt: true,
  approvedAt: true,
  _count: { select: { requirements: true } },
} as const;

export type RequirementRun = Awaited<
  ReturnType<typeof getRequirementRuns>
>[number];

export async function getRequirementRuns(
  workspaceId: string,
  projectId: string,
) {
  return prisma.generationRun.findMany({
    where: { workspaceId, projectId, type: "requirements" },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: requirementRunSelect,
  });
}

/**
 * Recomputes a requirements run's status from its rows.
 *
 * Called after every review transition so the run badge reflects what actually
 * happened rather than what the reviewer intended.
 */
export async function recomputeRequirementRunStatus(
  tx: Prisma.TransactionClient,
  generationRunId: string,
) {
  const counts = await tx.requirement.groupBy({
    by: ["generationStatus"],
    where: { generationRunId },
    _count: { _all: true },
  });

  // Every row deleted leaves nothing to derive a verdict from. Freezing the last
  // computed status is honest; calling an empty run "rejected" is not.
  if (counts.length === 0) return;

  const byStatus = new Map(
    counts.map((row) => [row.generationStatus, row._count._all]),
  );
  const drafts = byStatus.get("draft") ?? 0;
  const approved = byStatus.get("approved") ?? 0;
  const rejected = byStatus.get("rejected") ?? 0;
  if (drafts > 0) {
    await tx.generationRun.update({
      where: { id: generationRunId },
      data: { status: "draft", approvedAt: null },
    });
    return;
  }

  const status =
    approved > 0 && rejected > 0
      ? "partially_approved"
      : approved > 0
        ? "approved"
        : "rejected";
  await tx.generationRun.update({
    where: { id: generationRunId },
    data: {
      status,
      approvedAt: approved > 0 ? new Date() : null,
    },
  });
}
