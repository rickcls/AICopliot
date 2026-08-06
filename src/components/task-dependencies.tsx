"use client";

import { useState } from "react";
import { Select } from "@/components/ui";
import type { TaskRow } from "@/components/task-types";

/**
 * Dependency editor for one task card.
 *
 * The candidate list already excludes the task itself and anything it depends
 * on, but the server rejects both cases independently — this only keeps the
 * user out of a dead end, it is not the guard.
 */
export function TaskDependencies({
  task,
  allTasks,
  onChange,
  onError,
}: {
  task: TaskRow;
  allTasks: TaskRow[];
  onChange: (task: TaskRow) => void;
  onError: (message: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);

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
        onError(data.error ?? "Could not add the dependency.");
        return;
      }
      onChange({ ...task, dependencies: [...task.dependencies, data.dependency] });
    } catch {
      onError("Could not reach the server.");
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
        onError(data.error ?? "Could not remove the dependency.");
        return;
      }
      onChange({
        ...task,
        dependencies: task.dependencies.filter((d) => d.id !== dependencyId),
      });
    } catch {
      onError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {task.dependencies.length === 0 ? (
        <p className="text-xs text-slate-500">
          This task does not depend on anything.
        </p>
      ) : (
        <ul className="space-y-1">
          {task.dependencies.map((dependency) => (
            <li
              key={dependency.id}
              className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs"
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
                  <span className="truncate">
                    {dependency.dependsOnTask.title}
                  </span>
                  {dependency.source === "ai_suggested" ? (
                    <span className="shrink-0 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                      AI suggested
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  className="shrink-0 text-slate-500 hover:text-red-700 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void removeDependency(dependency.id)}
                  aria-label={`Remove dependency on ${dependency.dependsOnTask.title}`}
                >
                  Remove
                </button>
              </div>
              {dependency.citations.length > 0 ? (
                <ul className="mt-2 space-y-1.5 border-t border-slate-100 pt-2">
                  {dependency.citations.map((citation) => (
                    <li key={citation.id} className="text-slate-600">
                      <a
                        href={`/documents/${citation.chunk.document.id}`}
                        className="font-medium text-slate-700 underline hover:text-slate-900"
                      >
                        {citation.chunk.document.originalFilename}
                        {citation.chunk.pageNumber !== null
                          ? ` · page ${citation.chunk.pageNumber}`
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

      {candidates.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          No other task is available to depend on.
        </p>
      ) : (
        <Select
          aria-label={`Add a dependency for ${task.title}`}
          className="mt-2 h-8 w-full text-xs"
          value=""
          disabled={busy}
          onChange={(event) => void addDependency(event.target.value)}
        >
          <option value="">Add a dependency…</option>
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
