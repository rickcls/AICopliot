import { EvaluationsPanel } from "@/components/evaluations-panel";
import { requireAdmin, requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { computeMetrics } from "@/lib/evaluation/scoring";

export const dynamic = "force-dynamic";

export default async function EvaluationsPage() {
  // Admin-only: throws AuthError(403), which Next renders as an error boundary.
  const access = await requireWorkspace();
  requireAdmin(access);

  const [evaluations, projects] = await Promise.all([
    prisma.evaluationCase.findMany({
      where: { workspaceId: access.workspaceId },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { project: { select: { name: true } } },
    }),
    prisma.project.findMany({
      where: { workspaceId: access.workspaceId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const metrics = computeMetrics(
    evaluations.map((row) => ({
      shouldRefuse: row.shouldRefuse,
      refused: row.refused,
      autoScore: row.autoScore,
      result: row.result,
      citationCount: row.citationCount,
      latencyMs: row.latencyMs,
    })),
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Evaluations</h1>
        <p className="mt-1 text-sm text-slate-600">
          A regression suite for retrieval quality. Cases with expected keywords
          or a &ldquo;should refuse&rdquo; expectation are scored automatically;
          the rest fall to human review. Re-run them after changing a model,
          threshold, or chunk size and compare the metrics.
        </p>
      </div>
      <EvaluationsPanel
        projects={projects}
        initialEvaluations={evaluations.map((row) => ({
          id: row.id,
          question: row.question,
          groundingScope: row.groundingScope,
          expectedAnswerNotes: row.expectedAnswerNotes,
          expectedKeywords: row.expectedKeywords,
          shouldRefuse: row.shouldRefuse,
          actualAnswer: row.actualAnswer,
          retrievedChunkIds: Array.isArray(row.retrievedChunkIds)
            ? (row.retrievedChunkIds as string[])
            : null,
          confidence: row.confidence,
          latencyMs: row.latencyMs,
          modelName: row.modelName,
          citationCount: row.citationCount,
          refused: row.refused,
          autoScore: row.autoScore,
          projectId: row.projectId,
          project: row.project,
          result: row.result,
          createdAt: row.createdAt.toISOString(),
        }))}
        initialMetrics={metrics}
      />
    </div>
  );
}
