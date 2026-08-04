import { EvaluationsPanel } from "@/components/evaluations-panel";
import { requireAdmin, requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function EvaluationsPage() {
  // Admin-only: throws AuthError(403), which Next renders as an error boundary.
  const access = await requireWorkspace();
  requireAdmin(access);

  const evaluations = await prisma.evaluationCase.findMany({
    where: { workspaceId: access.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Evaluations</h1>
        <p className="mt-1 text-sm text-slate-600">
          Run a question through the live retrieval pipeline, record what came
          back, and mark whether the answer was acceptable.
        </p>
      </div>
      <EvaluationsPanel
        initialEvaluations={evaluations.map((row) => ({
          id: row.id,
          question: row.question,
          expectedAnswerNotes: row.expectedAnswerNotes,
          actualAnswer: row.actualAnswer,
          retrievedChunkIds: Array.isArray(row.retrievedChunkIds)
            ? (row.retrievedChunkIds as string[])
            : null,
          confidence: row.confidence,
          latencyMs: row.latencyMs,
          modelName: row.modelName,
          result: row.result,
          createdAt: row.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
