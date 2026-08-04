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
import { formatDate } from "@/lib/utils";

interface EvaluationRow {
  id: string;
  question: string;
  expectedAnswerNotes: string | null;
  actualAnswer: string | null;
  retrievedChunkIds: string[] | null;
  confidence: "high" | "medium" | "low" | null;
  latencyMs: number | null;
  modelName: string | null;
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

export function EvaluationsPanel({
  initialEvaluations,
  projects,
}: {
  initialEvaluations: EvaluationRow[];
  projects: Array<{ id: string; name: string }>;
}) {
  const [rows, setRows] = useState<EvaluationRow[]>(initialEvaluations);
  const [question, setQuestion] = useState("");
  const [notes, setNotes] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/evaluations");
      if (!response.ok) throw new Error("Could not load evaluations");
      const data = await response.json();
      setRows(data.evaluations);
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
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setRunning(false);
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

  return (
    <div className="space-y-6">
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
          <div>
            <label htmlFor="eval-notes" className="mb-1.5 block text-sm font-medium">
              Expected answer notes{" "}
              <span className="font-normal text-slate-500">(optional)</span>
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
          <div className="flex justify-end">
            <Button type="submit" disabled={running || question.trim().length < 3}>
              {running ? (
                <>
                  <Spinner className="border-white/40 border-t-white" />
                  Running…
                </>
              ) : (
                "Run evaluation"
              )}
            </Button>
          </div>
        </form>
      </Card>

      {error ? <ErrorState message={error} /> : null}

      {rows.length === 0 ? (
        <EmptyState
          title="No evaluation cases yet"
          description="Run a question above to capture the answer, the chunks it retrieved, and its latency — then mark it pass or fail."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card key={row.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="text-sm font-medium">{row.question}</p>
                <Badge tone={RESULT_TONE[row.result]}>{row.result}</Badge>
              </div>

              <p className="mt-1 text-xs text-slate-500">
                {formatDate(row.createdAt)}
                {row.modelName ? ` · ${row.modelName}` : ""}
                {` · ${row.project?.name ?? "All documents"}`}
                {row.latencyMs !== null
                  ? ` · ${(row.latencyMs / 1000).toFixed(1)}s`
                  : ""}
                {row.confidence ? ` · ${row.confidence} confidence` : ""}
                {row.retrievedChunkIds
                  ? ` · ${row.retrievedChunkIds.length} chunks retrieved`
                  : ""}
              </p>

              {row.expectedAnswerNotes ? (
                <div className="mt-3">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase">
                    Expected
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

              <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4">
                <span className="text-xs text-slate-500">Mark as</span>
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
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
