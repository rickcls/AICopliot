"use client";

import { useCallback, useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import type { Metrics } from "@/lib/evaluation/scoring";
import { formatDate } from "@/lib/utils";

interface EvaluationRow {
  id: string;
  question: string;
  expectedAnswerNotes: string | null;
  expectedKeywords: string[];
  shouldRefuse: boolean;
  actualAnswer: string | null;
  retrievedChunkIds: string[] | null;
  confidence: "high" | "medium" | "low" | null;
  latencyMs: number | null;
  modelName: string | null;
  citationCount: number;
  refused: boolean;
  autoScore: boolean | null;
  projectId: string | null;
  project: { name: string } | null;
  result: "pass" | "fail" | "unreviewed";
  createdAt: string;
}

const RESULT_TONE = {
  pass: "success",
  fail: "danger",
  unreviewed: "neutral",
} as const;

function pct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function MetricsSummary({ metrics }: { metrics: Metrics }) {
  const tiles = [
    {
      label: "Auto pass rate",
      value: pct(metrics.autoPassRate),
      hint: `${metrics.scored} of ${metrics.total} auto-scored`,
    },
    {
      label: "Refusal accuracy",
      value: pct(metrics.refusalAccuracy),
      hint: `${metrics.refusalCases} unanswerable case${metrics.refusalCases === 1 ? "" : "s"}`,
    },
    {
      label: "Citation rate",
      value: pct(metrics.citationRate),
      hint: "answerable cases with ≥1 citation",
    },
    {
      label: "Latency p95",
      value:
        metrics.p95LatencyMs === null
          ? "—"
          : `${(metrics.p95LatencyMs / 1000).toFixed(1)}s`,
      hint:
        metrics.medianLatencyMs === null
          ? "no runs yet"
          : `median ${(metrics.medianLatencyMs / 1000).toFixed(1)}s`,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <Card key={tile.label} className="p-4">
          <p className="text-xs text-slate-500">{tile.label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{tile.value}</p>
          <p className="mt-0.5 text-xs text-slate-400">{tile.hint}</p>
        </Card>
      ))}
    </div>
  );
}

export function EvaluationsPanel({
  initialEvaluations,
  initialMetrics,
  projects,
}: {
  initialEvaluations: EvaluationRow[];
  initialMetrics: Metrics;
  projects: Array<{ id: string; name: string }>;
}) {
  const [rows, setRows] = useState<EvaluationRow[]>(initialEvaluations);
  const [metrics, setMetrics] = useState<Metrics>(initialMetrics);
  const [question, setQuestion] = useState("");
  const [notes, setNotes] = useState("");
  const [keywords, setKeywords] = useState("");
  const [shouldRefuse, setShouldRefuse] = useState(false);
  const [running, setRunning] = useState(false);
  const [runningAll, setRunningAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/evaluations");
      if (!response.ok) throw new Error("Could not load evaluations");
      const data = await response.json();
      setRows(data.evaluations);
      setMetrics(data.metrics);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  async function handleRun(event: React.FormEvent) {
    event.preventDefault();
    if (question.trim().length < 3 || running) return;

    setRunning(true);
    setError(null);

    try {
      const response = await fetch("/api/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: question.trim(),
          expectedAnswerNotes: notes.trim() || undefined,
          expectedKeywords: keywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean),
          shouldRefuse,
          projectId: projectId || null,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? "Could not run the evaluation.");
        return;
      }

      setQuestion("");
      setNotes("");
      setKeywords("");
      setShouldRefuse(false);
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setRunning(false);
    }
  }

  async function handleRunAll() {
    if (runningAll || rows.length === 0) return;
    if (
      !confirm(
        `Re-run all ${rows.length} case(s) against the current pipeline? This makes a model call per case.`,
      )
    ) {
      return;
    }

    setRunningAll(true);
    setError(null);

    try {
      const response = await fetch("/api/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run-all" }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? "Regression run failed.");
        return;
      }

      setRows(data.evaluations);
      setMetrics(data.metrics);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setRunningAll(false);
    }
  }

  async function review(id: string, result: "pass" | "fail") {
    const response = await fetch("/api/evaluations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, result }),
    }).catch(() => null);

    if (response?.ok) {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, result } : r)));
    } else {
      setError("Could not save the review.");
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this evaluation case?")) return;
    const response = await fetch(`/api/evaluations?id=${id}`, {
      method: "DELETE",
    }).catch(() => null);

    if (response?.ok) {
      await load();
    } else {
      setError("Could not delete that case.");
    }
  }

  return (
    <div className="space-y-6">
      <MetricsSummary metrics={metrics} />

      <Card className="p-4">
        <form onSubmit={handleRun} className="space-y-3">
          <div>
            <label htmlFor="eval-project" className="mb-1.5 block text-sm font-medium">
              Project scope
            </label>
            <Select
              id="eval-project"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              disabled={running}
              className="w-full"
            >
              <option value="">All documents</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="eval-question" className="mb-1.5 block text-sm font-medium">
              Question
            </label>
            <Input
              id="eval-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What should the on-call engineer do first during a Sev-1?"
              disabled={running}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="eval-keywords" className="mb-1.5 block text-sm font-medium">
                Expected keywords{" "}
                <span className="font-normal text-slate-500">(comma separated)</span>
              </label>
              <Input
                id="eval-keywords"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="repmgr, pg_isready, 30 seconds"
                disabled={running || shouldRefuse}
              />
              <p className="mt-1.5 text-xs text-slate-500">
                All must appear for an automatic pass.
              </p>
            </div>

            <div>
              <span className="mb-1.5 block text-sm font-medium">Expectation</span>
              <label className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={shouldRefuse}
                  onChange={(e) => setShouldRefuse(e.target.checked)}
                  disabled={running}
                  className="size-4"
                />
                Should refuse (not in the documents)
              </label>
              <p className="mt-1.5 text-xs text-slate-500">
                Passes only if the assistant declines to answer.
              </p>
            </div>
          </div>

          <div>
            <label htmlFor="eval-notes" className="mb-1.5 block text-sm font-medium">
              Notes <span className="font-normal text-slate-500">(optional)</span>
            </label>
            <Textarea
              id="eval-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What a correct answer should mention."
              disabled={running}
            />
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={handleRunAll}
              disabled={runningAll || running || rows.length === 0}
            >
              {runningAll ? (
                <>
                  <Spinner />
                  Re-running {rows.length}…
                </>
              ) : (
                `Re-run all (${rows.length})`
              )}
            </Button>
            <Button type="submit" disabled={running || question.trim().length < 3}>
              {running ? (
                <>
                  <Spinner className="border-white/40 border-t-white" />
                  Running…
                </>
              ) : (
                "Add & run case"
              )}
            </Button>
          </div>
        </form>
      </Card>

      {error ? <ErrorState message={error} /> : null}

      {rows.length === 0 ? (
        <EmptyState
          title="No evaluation cases yet"
          description="Add a question with expected keywords, or mark it as one the documents cannot answer. Cases are auto-scored and can be re-run as a regression suite."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card key={row.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="text-sm font-medium">{row.question}</p>
                <div className="flex items-center gap-2">
                  {row.shouldRefuse ? (
                    <Badge tone="info">expects refusal</Badge>
                  ) : null}
                  {row.autoScore !== null ? (
                    <Badge tone={row.autoScore ? "success" : "danger"}>
                      auto {row.autoScore ? "pass" : "fail"}
                    </Badge>
                  ) : (
                    <Badge tone={RESULT_TONE[row.result]}>{row.result}</Badge>
                  )}
                </div>
              </div>

              <p className="mt-1 text-xs text-slate-500">
                {formatDate(row.createdAt)}
                {row.modelName ? ` · ${row.modelName}` : ""}
                {` · ${row.project?.name ?? "All documents"}`}
                {row.latencyMs !== null
                  ? ` · ${(row.latencyMs / 1000).toFixed(1)}s`
                  : ""}
                {row.confidence ? ` · ${row.confidence}` : ""}
                {` · ${row.citationCount} citation${row.citationCount === 1 ? "" : "s"}`}
                {row.retrievedChunkIds
                  ? ` · ${row.retrievedChunkIds.length} chunks`
                  : ""}
              </p>

              {row.expectedKeywords.length > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-slate-500">Expects:</span>
                  {row.expectedKeywords.map((keyword) => {
                    const found = (row.actualAnswer ?? "")
                      .toLowerCase()
                      .includes(keyword.toLowerCase());
                    return (
                      <Badge key={keyword} tone={found ? "success" : "danger"}>
                        {keyword}
                      </Badge>
                    );
                  })}
                </div>
              ) : null}

              {row.expectedAnswerNotes ? (
                <div className="mt-3">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase">
                    Notes
                  </h3>
                  <p className="mt-1 text-sm text-pretty text-slate-600">
                    {row.expectedAnswerNotes}
                  </p>
                </div>
              ) : null}

              <div className="mt-3">
                <h3 className="text-xs font-semibold text-slate-500 uppercase">
                  Actual
                </h3>
                <p className="mt-1 text-sm whitespace-pre-wrap text-pretty text-slate-700">
                  {row.actualAnswer ?? "—"}
                </p>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                <span className="text-xs text-slate-500">
                  {row.autoScore !== null ? "Override:" : "Mark as"}
                </span>
                <Button
                  size="sm"
                  variant={row.result === "pass" ? "secondary" : "ghost"}
                  onClick={() => review(row.id, "pass")}
                >
                  Pass
                </Button>
                <Button
                  size="sm"
                  variant={row.result === "fail" ? "secondary" : "ghost"}
                  onClick={() => review(row.id, "fail")}
                >
                  Fail
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto text-red-600 hover:bg-red-50"
                  onClick={() => remove(row.id)}
                >
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
