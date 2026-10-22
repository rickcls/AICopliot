"use client";

import { useState } from "react";
import { useT } from "@/components/i18n-provider";
import { Badge, Select } from "@/components/ui";
import type { TaskRow } from "@/components/task-types";

/**
 * Dependency editor for one task card.
 *
 * The candidate list already excludes the task itself and anything it depends
 * on, but the server rejects both cases independently — this only keeps the
 * user out of a dead end, it is not the guard.
 *
 * Edges are stored one way, so the tasks that depend on this one are found in
 * the board's own rows. That is what shows a task made from a "How to tackle
 * it" step which task it was made for.
 */
export function TaskDependencies({
  task,
  allTasks,
  onChange,
  onError,
  onOpenTask,
}: {
  task: TaskRow;
  allTasks: TaskRow[];
  onChange: (task: TaskRow) => void;
  onError: (message: string | null) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const t = useT();

  const neededFor = allTasks.filter((other) =>
    other.dependencies.some((dependency) => dependency.dependsOnTaskId === task.id),
  );
  const existing = new Set(task.dependencies.map((d) => d.dependsOnTaskId));
  const candidates = allTasks.filter(
    (candidate) => candidate.id !== task.id && !existing.has(candidate.id),
  );

  async function addDependency(dependsOnTaskId: string) {
    if (!dependsOnTaskId) return;
    setBusy(true);
    onError(null);
    try {
      const response = await fetch(`/api/tasks/${task.id}/dependencies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dependsOnTaskId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        onError(data.error ?? t("tasks.dependencies.addFailed"));
        return;
      }
      onChange({ ...task, dependencies: [...task.dependencies, data.dependency] });
    } catch {
      onError(t("common.couldNotReach"));
    } finally {
      setBusy(false);
    }
  }

  async function removeDependency(dependencyId: string) {
    setBusy(true);
    onError(null);
    try {
      const response = await fetch(
        `/api/tasks/${task.id}/dependencies/${dependencyId}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        onError(data.error ?? t("tasks.dependencies.removeFailed"));
        return;
      }
      onChange({
        ...task,
        dependencies: task.dependencies.filter((d) => d.id !== dependencyId),
      });
    } catch {
      onError(t("common.couldNotReach"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {task.dependencies.length === 0 ? (
        <p className="text-xs text-sand-500">{t("tasks.dependencies.none")}</p>
      ) : (
        <ul className="space-y-1">
          {task.dependencies.map((dependency) => (
            <li
              key={dependency.id}
              className="rounded-lg border border-sand-200 px-2.5 py-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    aria-hidden
                    className={
                      dependency.dependsOnTask.status.category === "done"
                        ? "size-1.5 shrink-0 rounded-full bg-emerald-500"
                        : "size-1.5 shrink-0 rounded-full bg-amber-500"
                    }
                  />
                  <button
                    type="button"
                    className="truncate text-left hover:underline"
                    onClick={() => onOpenTask(dependency.dependsOnTaskId)}
                  >
                    {dependency.dependsOnTask.title}
                  </button>
                  {dependency.source === "ai_suggested" ? (
                    <Badge tone="info" className="shrink-0">
                      {t("tasks.fields.aiSuggested")}
                    </Badge>
                  ) : null}
                </span>
                <button
                  type="button"
                  className="shrink-0 text-sand-500 hover:text-red-700 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void removeDependency(dependency.id)}
                  aria-label={t("tasks.dependencies.removeLabel", {
                    title: dependency.dependsOnTask.title,
                  })}
                >
                  {t("common.remove")}
                </button>
              </div>
              {dependency.citations.length > 0 ? (
                <ul className="mt-2 space-y-1.5 border-t border-sand-100 pt-2">
                  {dependency.citations.map((citation) => (
                    <li key={citation.id} className="text-sand-600">
                      <a
                        href={`/documents/${citation.chunk.document.id}`}
                        className="font-medium text-sand-700 underline hover:text-sand-900"
                      >
                        {citation.chunk.document.originalFilename}
                        {citation.chunk.pageNumber !== null
                          ? ` · ${t("common.page", { page: citation.chunk.pageNumber })}`
                          : ""}
                        {citation.chunk.sectionTitle
                          ? ` · ${citation.chunk.sectionTitle}`
                          : ""}
                      </a>
                      {citation.excerpt ? (
                        <p className="mt-0.5 leading-5">“{citation.excerpt}”</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {neededFor.length > 0 ? (
        <div className="mt-3">
          <p className="mb-1 text-xs font-medium text-sand-500">
            {t("tasks.dependencies.neededFor")}
          </p>
          <ul className="space-y-1">
            {neededFor.map((other) => (
              <li key={other.id}>
                <button
                  type="button"
                  className="flex w-full min-w-0 items-center gap-1.5 rounded-lg border border-sand-200 px-2.5 py-2 text-left text-xs hover:bg-sand-50"
                  onClick={() => onOpenTask(other.id)}
                >
                  <span
                    aria-hidden
                    className={
                      other.status.category === "done"
                        ? "size-1.5 shrink-0 rounded-full bg-emerald-500"
                        : "size-1.5 shrink-0 rounded-full bg-amber-500"
                    }
                  />
                  <span className="truncate">{other.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {candidates.length === 0 ? (
        <p className="mt-2 text-xs text-sand-500">
          {t("tasks.dependencies.noCandidates")}
        </p>
      ) : (
        <Select
          aria-label={t("tasks.dependencies.addLabel", { title: task.title })}
          className="mt-2 h-8 w-full text-xs"
          value=""
          disabled={busy}
          onChange={(event) => void addDependency(event.target.value)}
        >
          <option value="">{t("tasks.dependencies.add")}</option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.title}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}
