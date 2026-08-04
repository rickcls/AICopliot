import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireAdmin, requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { answerQuestion } from "@/lib/rag/answer";
import { createEvaluationSchema, reviewEvaluationSchema } from "@/lib/schemas";

export async function GET() {
  try {
    const access = await requireWorkspace();
    requireAdmin(access);

    const evaluations = await prisma.evaluationCase.findMany({
      where: { workspaceId: access.workspaceId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return NextResponse.json({ evaluations });
  } catch (error) {
    return handleRouteError(error, "GET /api/evaluations");
  }
}

/** Runs the real RAG pipeline and records the result as an evaluation case. */
export async function POST(request: Request) {
  try {
    const access = await requireWorkspace();
    requireAdmin(access);

    const body = await request.json().catch(() => null);
    const parsed = createEvaluationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const { question, expectedAnswerNotes } = parsed.data;
    const result = await answerQuestion(access.workspaceId, question);

    const evaluation = await prisma.evaluationCase.create({
      data: {
        workspaceId: access.workspaceId,
        question,
        expectedAnswerNotes,
        actualAnswer: result.answer,
        retrievedChunkIds: result.retrievedChunkIds,
        confidence: result.confidence,
        latencyMs: result.latencyMs,
        modelName: result.modelName,
        result: "unreviewed",
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
