"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, Lightbulb } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import type { TaskRow } from "@/components/task-types";
import { useToast } from "@/components/toast";
import { Badge, Button, CHECKBOX, ErrorState, Spinner } from "@/components/ui";
import { stepsAsDescription } from "@/lib/approach/format";
import type { ApproachView } from "@/lib/approach/service";
import { cn } from "@/lib/utils";

/**
 * "How to tackle it" for one task.
 *
 * Steps that rest on the person's documents and steps that are the
 * assistant's general suggestion are drawn as two different things — a
 * source chip on one, an explicit "AI suggestion" marker on the other — so
 * general advice never reads as something the files said. Nothing here edits
 * the task by itself: adding the steps to the description goes through the
 * panel's own save, and creating tasks goes through the shared write path.
 */
export function TaskApproach({
  taskId,
  onAppend,
  onTasksCreated,
}: {
  taskId: string;
  /** Appends text to the task's description through the panel's own save. */
  onAppend: (text: string) => Promise<boolean>;
  onTasksCreated: (tasks: TaskRow[]) => void;
}) {
  const t = useT();
  const toast = useToast();
  const [approach, setApproach] = useState<ApproachView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<"ask" | "append" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/tasks/${taskId}/approach`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        setApproach(response.ok ? (data.approach ?? null) : null);
        setLoaded(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded(true);
      });
    return () => controller.abort();
  }, [taskId]);

  async function ask() {
    setBusy("ask");
    setError(null);
    try {
      const response = await fetch(`/api/tasks/${taskId}/approach`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.approach) {
        setError(data.error ?? t("approach.failed"));
        return;
      }
      setApproach(data.approach);
      setSelected(new Set());
    } catch {
      setError(t("common.couldNotReach"));
    } finally {
      setBusy(null);
    }
  }

  async function append() {
    if (!approach) return;
    setBusy("append");
    if (await onAppend(stepsAsDescription(approach.steps, t("approach.generalMarker")))) {
      toast.success(t("approach.appended"));
    }
    setBusy(null);
  }

  async function createTasks() {
    if (!approach || selected.size === 0) return;
    setBusy("create");
    try {
      const response = await fetch(`/api/task-suggestions/${approach.id}/create-tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepIndexes: [...selected] }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(t("approach.createFailed"), data.error);
        return;
      }
      const tasks = (data.tasks ?? []) as TaskRow[];
      onTasksCreated(tasks);
      setApproach({ ...approach, createdSteps: [...approach.createdSteps, ...selected] });
      setSelected(new Set());
      toast.success(t("approach.createdCount", { count: tasks.length }));
    } catch {
      toast.error(t("common.couldNotReach"));
    } finally {
      setBusy(null);
    }
  }

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-slate-500">
        <Spinner />
      </div>
    );
  }

  const sourceByLabel = new Map((approach?.sources ?? []).map((source) => [source.label, source]));

  return (
    <div className="space-y-4 p-4">
      <p className="text-xs text-slate-500">{t("approach.lead")}</p>

      {error ? <ErrorState message={error} /> : null}

      {!approach ? (
        <Button type="button" disabled={busy !== null} onClick={() => void ask()}>
          {busy === "ask" ? <Spinner className="border-white/40 border-t-white" /> : <Lightbulb className="size-4" aria-hidden />}
          {busy === "ask" ? t("approach.asking") : t("approach.ask")}
        </Button>
      ) : (
        <>
          <p className="text-xs text-slate-500">
            {approach.evidence === "none"
              ? t("approach.noEvidence")
              : approach.evidence === "linked"
                ? t("approach.evidenceLinked")
                : t("approach.evidenceProject")}
          </p>
          {approach.note ? <p className="text-sm text-pretty text-slate-700">{approach.note}</p> : null}

          <ol className="space-y-2">
            {approach.steps.map((step, index) => {
              const created = approach.createdSteps.includes(index);
              return (
                <li
                  key={index}
                  className={cn(
                    "flex gap-3 rounded-lg border p-3",
                    step.basis === "general" ? "border-dashed border-violet-200 bg-violet-50/40" : "border-slate-200",
                  )}
                >
                  <input
                    type="checkbox"
                    className={cn(CHECKBOX, "mt-0.5")}
                    aria-label={t("approach.selectStep", { index: index + 1 })}
                    disabled={created}
                    checked={selected.has(index)}
                    onChange={() =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (next.has(index)) next.delete(index);
                        else next.add(index);
                        return next;
                      })
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-pretty text-slate-900">
                      <span className="mr-1.5 font-semibold tabular-nums">{index + 1}.</span>
                      {step.text}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {step.basis === "general" ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-violet-700">
                          <Lightbulb className="size-3" aria-hidden />
                          {t("approach.general")}
                        </span>
                      ) : (
                        step.citations.map((label) => {
                          const source = sourceByLabel.get(label);
                          return source ? (
                            <Link
                              key={label}
                              href={`/documents/${source.documentId}/chunks?chunk=${source.chunkId}#chunk-${source.chunkId}`}
                              title={source.excerpt}
                              className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700 hover:bg-slate-200"
                            >
                              <BookOpen className="size-3" aria-hidden />
                              <span className="max-w-40 truncate">{source.filename}</span>
                              {source.pageNumber !== null ? (
                                <span className="text-slate-500">
                                  {t("approach.page", { page: source.pageNumber })}
                                </span>
                              ) : null}
                            </Link>
                          ) : null;
                        })
                      )}
                      {created ? <Badge tone="success">{t("approach.alreadyCreated")}</Badge> : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={busy !== null} onClick={() => void append()}>
              {busy === "append" ? <Spinner className="border-white/40 border-t-white" /> : null}
              {t("approach.appendToDescription")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy !== null || selected.size === 0}
              onClick={() => void createTasks()}
            >
              {busy === "create" ? <Spinner /> : null}
              {t("approach.createTasks")}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => void ask()}>
              {busy === "ask" ? <Spinner /> : null}
              {busy === "ask" ? t("approach.asking") : t("approach.again")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
