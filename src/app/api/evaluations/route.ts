import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireAdmin, requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { computeMetrics, scoreEvaluation } from "@/lib/evaluation/scoring";
import { answerQuestion } from "@/lib/rag/answer";
import {
  createEvaluationSchema,
  reviewEvaluationSchema,
  runEvaluationsSchema,
} from "@/lib/schemas";

/** Cap on a single run-all pass, so one click cannot spend unbounded credit. */
const MAX_CASES_PER_RUN = 50;

function toMetricInput(row: {
  shouldRefuse: boolean;
  refused: boolean;
  autoScore: boolean | null;
  result: "pass" | "fail" | "unreviewed";
  citationCount: number;
  latencyMs: number | null;
}) {
  return {
    shouldRefuse: row.shouldRefuse,
    refused: row.refused,
    autoScore: row.autoScore,
    result: row.result,
    citationCount: row.citationCount,
    latencyMs: row.latencyMs,
  };
}

export async function GET() {
  try {
    const access = await requireWorkspace();
    requireAdmin(access);

    const evaluations = await prisma.evaluationCase.findMany({
      where: { workspaceId: access.workspaceId },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return NextResponse.json({
      evaluations,
      metrics: computeMetrics(evaluations.map(toMetricInput)),
    });
  } catch (error) {
    return handleRouteError(error, "GET /api/evaluations");
  }
}

/** Creates a case by running the question through the live pipeline. */
export async function POST(request: Request) {
  try {
    const access = await requireWorkspace();
    requireAdmin(access);

    const body = await request.json().catch(() => null);

    // Same endpoint serves the regression run, distinguished by an action field.
    if (runEvaluationsSchema.safeParse(body).success) {
      return runAll(access.workspaceId);
    }

    const parsed = createEvaluationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const { question, expectedAnswerNotes, expectedKeywords, shouldRefuse } =
      parsed.data;

    const result = await answerQuestion(access.workspaceId, question);
    const autoScore = scoreEvaluation(
      { expectedKeywords, shouldRefuse },
      {
        answer: result.answer,
        refused: result.refused,
        citationCount: result.citations.length,
      },
    );

    const evaluation = await prisma.evaluationCase.create({
      data: {
        workspaceId: access.workspaceId,
        question,
        expectedAnswerNotes,
        expectedKeywords,
        shouldRefuse,
        actualAnswer: result.answer,
        retrievedChunkIds: result.retrievedChunkIds,
        confidence: result.confidence,
        latencyMs: result.latencyMs,
        modelName: result.modelName,
        citationCount: result.citations.length,
        refused: result.refused,
        autoScore,
        // Auto-scored cases carry their verdict; the rest await a human.
        result: autoScore === null ? "unreviewed" : autoScore ? "pass" : "fail",
      },
    });

    return NextResponse.json(
      { evaluation, citations: result.citations, refused: result.refused },
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error, "POST /api/evaluations");
  }
}

/**
 * Re-runs every stored case against the current pipeline. This is the
 * regression check: change a chunk size, a threshold, or a model, run this, and
 * compare the metrics.
 */
async function runAll(workspaceId: string) {
  const cases = await prisma.evaluationCase.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
    take: MAX_CASES_PER_RUN,
  });

  for (const testCase of cases) {
    try {
      const result = await answerQuestion(workspaceId, testCase.question);
      const autoScore = scoreEvaluation(
        {
          expectedKeywords: testCase.expectedKeywords,
          shouldRefuse: testCase.shouldRefuse,
        },
        {
          answer: result.answer,
          refused: result.refused,
          citationCount: result.citations.length,
        },
      );

      await prisma.evaluationCase.update({
        where: { id: testCase.id },
        data: {
          actualAnswer: result.answer,
          retrievedChunkIds: result.retrievedChunkIds,
          confidence: result.confidence,
          latencyMs: result.latencyMs,
          modelName: result.modelName,
          citationCount: result.citations.length,
          refused: result.refused,
          autoScore,
          // Preserve an existing human verdict on cases rules cannot decide.
          result:
            autoScore === null
              ? testCase.result
              : autoScore
                ? "pass"
                : "fail",
        },
      });
    } catch (cause) {
      console.error(`[evaluations] case ${testCase.id} failed:`, cause);
      await prisma.evaluationCase.update({
        where: { id: testCase.id },
        data: {
          actualAnswer: `Run failed: ${(cause as Error).message}`.slice(0, 500),
          autoScore: false,
          result: "fail",
        },
      });
    }
  }

  const refreshed = await prisma.evaluationCase.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json({
    ran: cases.length,
    evaluations: refreshed,
    metrics: computeMetrics(refreshed.map(toMetricInput)),
  });
}

/** Records the human pass/fail verdict. */
export async function PATCH(request: Request) {
  try {
    const access = await requireWorkspace();
    requireAdmin(access);

    const body = await request.json().catch(() => null);
    const parsed = reviewEvaluationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const existing = await prisma.evaluationCase.findFirst({
      where: { id: parsed.data.id, workspaceId: access.workspaceId },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Evaluation not found" }, { status: 404 });
    }

    const evaluation = await prisma.evaluationCase.update({
      where: { id: existing.id },
      data: { result: parsed.data.result },
    });

    return NextResponse.json({ evaluation });
  } catch (error) {
    return handleRouteError(error, "PATCH /api/evaluations");
  }
}

export async function DELETE(request: Request) {
  try {
    const access = await requireWorkspace();
    requireAdmin(access);

    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const existing = await prisma.evaluationCase.findFirst({
      where: { id, workspaceId: access.workspaceId },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Evaluation not found" }, { status: 404 });
    }

    await prisma.evaluationCase.delete({ where: { id: existing.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "DELETE /api/evaluations");
  }
}
