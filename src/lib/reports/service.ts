import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { officialRecordWhere } from "@/lib/pm/rules";
import { getChatProvider, type ChatProvider } from "@/lib/providers";
import type { ChatMessageInput } from "@/lib/providers/types";
import { validateAnswer } from "@/lib/rag/citations";
import { buildCombinedContext, buildUserMessage } from "@/lib/rag/prompt";
import { modelAnswerSchema, type ProjectCitation } from "@/lib/schemas";
import { savedStatusReportSchema } from "./schemas";
import {
  buildDeterministicStatusReport,
  buildReportGroundingSources,
  hasReportableData,
  type SavedStatusReport,
  type StatusReportSourceData,
} from "./status-report";

const STATUS_REPORT_PROMPT_VERSION = "status-report-v1";

const STATUS_REPORT_SYSTEM_PROMPT = `You are ScopePilot, an AI project delivery copilot.

Write only a concise executive narrative for a weekly project status report. The deterministic sections are rendered separately, so do not reproduce long lists.

Rules:
1. Use only the supplied CURRENT PROJECT DATA sources. Never use outside knowledge.
2. Every factual sentence must be supported by a cited opaque source label.
3. State the supplied derived health exactly; do not recalculate or change it.
4. Prioritize completed work, blockers/overdue work, active risks, and the next seven days.
5. Exact aggregate counts come from the PROJECT SNAPSHOT. A detailed source list may be marked partial; never describe it as complete when it is partial.
6. If the sources are insufficient, set insufficientContext to true. Never invent work, dates, owners, or risks.

Respond with one JSON object and nothing else:
{
  "answer": "string",
  "confidence": "high" | "medium" | "low",
  "insufficientContext": boolean,
  "citations": [{ "sourceId": "P1", "quote": "short verbatim excerpt from that source" }]
}`;

export class StatusReportRequestError extends Error {
  constructor(
    message: string,
    readonly status: 422 | 502,
  ) {
    super(message);
    this.name = "StatusReportRequestError";
  }
}

export interface GenerateStatusReportInput {
  workspaceId: string;
  projectId: string;
  userId: string;
}

export interface GenerateStatusReportDeps {
  chat?: ChatProvider;
  now?: Date;
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced) return fenced[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start !== -1 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

function parseModelNarrative(raw: string) {
  let value: unknown;
  try {
    value = JSON.parse(extractJsonObject(raw));
  } catch {
    return null;
  }
  const parsed = modelAnswerSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function loadStatusReportSourceData(
  workspaceId: string,
  projectId: string,
): Promise<StatusReportSourceData | null> {
  const official = <T extends object>(where: T) => officialRecordWhere(where);
  const [project, tasks, milestones, risks, dependencies] = await Promise.all([
    prisma.project.findFirst({
      where: { id: projectId, workspaceId },
      select: { id: true, name: true },
    }),
    prisma.task.findMany({
      where: official({ workspaceId, projectId }),
      orderBy: [{ completedAt: "desc" }, { dueDate: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        dueDate: true,
        completedAt: true,
        assignee: { select: { name: true, email: true } },
        milestone: { select: { title: true } },
      },
    }),
    prisma.milestone.findMany({
      where: official({ workspaceId, projectId }),
      orderBy: [
        { completedAt: "desc" },
        { targetDate: "asc" },
        { createdAt: "asc" },
      ],
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        targetDate: true,
        completedAt: true,
      },
    }),
    prisma.projectRisk.findMany({
      where: official({ workspaceId, projectId }),
      orderBy: [{ impact: "desc" }, { likelihood: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        description: true,
        impact: true,
        likelihood: true,
        mitigation: true,
        status: true,
        milestone: { select: { title: true } },
      },
    }),
    prisma.taskDependency.findMany({
      where: official({
        workspaceId,
        task: official({ workspaceId, projectId }),
        dependsOnTask: official({ workspaceId, projectId }),
      }),
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        task: { select: { id: true, title: true, status: true } },
        dependsOnTask: { select: { id: true, title: true, status: true } },
      },
    }),
  ]);

  if (!project) return null;
  return { project, tasks, milestones, risks, dependencies };
}

function selectedContext(data: StatusReportSourceData, report: SavedStatusReport | Omit<SavedStatusReport, "narrative" | "confidence" | "citations">, sourceAudit: unknown) {
  return {
    observedAt: report.observedAt,
    taskIds: data.tasks.map((task) => task.id),
    milestoneIds: data.milestones.map((milestone) => milestone.id),
    riskIds: data.risks.map((risk) => risk.id),
    dependencyIds: data.dependencies.map((dependency) => dependency.id),
    promptSources: sourceAudit,
  };
}

function failureMessage(error: unknown): string {
  return (error instanceof Error ? error.message : "Status report generation failed").slice(
    0,
    2000,
  );
}

async function completeNarrative(
  chat: ChatProvider,
  messages: ChatMessageInput[],
): Promise<string> {
  try {
    return await chat.complete(messages, {
      jsonMode: true,
      temperature: 0,
      maxTokens: 1400,
    });
  } catch {
    throw new StatusReportRequestError(
      "The model provider is unavailable for status report generation.",
      502,
    );
  }
}

export async function generateStatusReport(
  input: GenerateStatusReportInput,
  deps: GenerateStatusReportDeps = {},
) {
  const now = deps.now ?? new Date();
  const data = await loadStatusReportSourceData(input.workspaceId, input.projectId);
  if (!data || !hasReportableData(data)) {
    throw new StatusReportRequestError(
      "This project has no approved tasks, milestones, risks, or dependencies to report.",
      422,
    );
  }

  const deterministic = buildDeterministicStatusReport(data, now);
  const sources = buildReportGroundingSources(deterministic);
  const { contextBlock, sourceMap, groundingSources } = buildCombinedContext([], sources);
  const startedAt = Date.now();
  const run = await prisma.generationRun.create({
    data: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      type: "status_report",
      // Provider construction is inside the audited try/catch below. A broken
      // environment must still leave a failed run rather than disappearing.
      model: deps.chat?.modelName ?? "pending",
      promptVersion: STATUS_REPORT_PROMPT_VERSION,
      selectedContextIds: jsonValue(
        selectedContext(data, deterministic, groundingSources),
      ),
      status: "processing",
      createdBy: input.userId,
    },
    select: { id: true },
  });
  const attempts: string[] = [];

  try {
    let chat: ChatProvider;
    try {
      chat = deps.chat ?? getChatProvider();
    } catch {
      throw new StatusReportRequestError(
        "The model provider is not configured for status report generation.",
        502,
      );
    }
    await prisma.generationRun.update({
      where: { id: run.id },
      data: { model: chat.modelName },
    });

    const messages = [
      { role: "system" as const, content: STATUS_REPORT_SYSTEM_PROMPT },
      {
        role: "user" as const,
        content: buildUserMessage(
          `Write the executive narrative for the ${deterministic.period.start} through ${deterministic.period.end} weekly report. The derived health is ${deterministic.health}.`,
          contextBlock,
        ),
      },
    ];
    attempts.push(await completeNarrative(chat, messages));
    let parsed = parseModelNarrative(attempts[0]);

    if (!parsed) {
      attempts.push(
        await completeNarrative(
          chat,
          [
            ...messages,
            {
              role: "user" as const,
              content:
                "Your previous reply was not valid JSON. Reply with ONLY the JSON object described in the system prompt.",
            },
          ],
        ),
      );
      parsed = parseModelNarrative(attempts[1]);
    }

    if (!parsed) {
      throw new StatusReportRequestError(
        "The model did not return a valid status report narrative.",
        502,
      );
    }

    const validated = validateAnswer(parsed, sourceMap, {
      refusalText: "The current project records do not support a weekly narrative.",
    });
    if (validated.refused) {
      throw new StatusReportRequestError(
        "The model did not provide a cited status report narrative.",
        502,
      );
    }
    const citations = validated.citations.filter(
      (citation): citation is ProjectCitation => citation.kind !== "document",
    );
    const hasDetailedReportItems =
      deterministic.counts.completedTasksInPeriod +
        deterministic.counts.completedMilestonesInPeriod +
        deterministic.counts.blockers +
        deterministic.counts.overdue +
        deterministic.counts.upcoming +
        deterministic.counts.activeRisks +
        deterministic.counts.dependencyBlockers >
      0;
    if (
      citations.length === 0 ||
      !citations.some((citation) => citation.kind === "project_snapshot") ||
      (hasDetailedReportItems &&
        !citations.some((citation) => citation.kind !== "project_snapshot")) ||
      !validated.answer.toLocaleLowerCase().includes(deterministic.health)
    ) {
      throw new StatusReportRequestError(
        "The model did not provide a snapshot-cited narrative with the derived health.",
        502,
      );
    }

    const report: SavedStatusReport = {
      ...deterministic,
      narrative: validated.answer,
      confidence: validated.confidence,
      citations,
    };
    const checked = savedStatusReportSchema.parse(report);
    const latencyMs = Date.now() - startedAt;
    const saved = await prisma.generationRun.update({
      where: { id: run.id },
      data: {
        model: chat.modelName,
        rawOutput: JSON.stringify({ attempts }),
        validatedOutput: jsonValue(checked),
        status: "draft",
        latencyMs,
        errorMessage: null,
      },
    });

    return serializeStatusReportRun(saved);
  } catch (error) {
    await prisma.generationRun
      .update({
        where: { id: run.id },
        data: {
          rawOutput: attempts.length > 0 ? JSON.stringify({ attempts }) : null,
          status: "failed",
          latencyMs: Date.now() - startedAt,
          errorMessage: failureMessage(error),
        },
      })
      .catch((auditError) => {
        console.error("[status-report] could not persist failed run:", auditError);
      });
    throw error;
  }
}

function serializeStatusReportRun(row: {
  id: string;
  projectId: string;
  model: string;
  promptVersion: string;
  status: string;
  errorMessage: string | null;
  latencyMs: number | null;
  validatedOutput: unknown;
  createdAt: Date;
}) {
  const parsed = savedStatusReportSchema.safeParse(row.validatedOutput);
  return {
    id: row.id,
    projectId: row.projectId,
    model: row.model,
    promptVersion: row.promptVersion,
    status: row.status,
    errorMessage: row.errorMessage,
    latencyMs: row.latencyMs,
    createdAt: row.createdAt.toISOString(),
    report: parsed.success ? parsed.data : null,
  };
}

export async function listStatusReports(workspaceId: string, projectId: string) {
  const rows = await prisma.generationRun.findMany({
    where: { workspaceId, projectId, type: "status_report" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      projectId: true,
      model: true,
      promptVersion: true,
      status: true,
      errorMessage: true,
      latencyMs: true,
      validatedOutput: true,
      createdAt: true,
    },
  });
  return rows.map(serializeStatusReportRun);
}

export async function getStatusReport(workspaceId: string, id: string) {
  const row = await prisma.generationRun.findFirst({
    where: { id, workspaceId, type: "status_report" },
    select: {
      id: true,
      projectId: true,
      model: true,
      promptVersion: true,
      status: true,
      errorMessage: true,
      latencyMs: true,
      validatedOutput: true,
      createdAt: true,
    },
  });
  return row ? serializeStatusReportRun(row) : null;
}

export type StatusReportRun = Awaited<ReturnType<typeof listStatusReports>>[number];
