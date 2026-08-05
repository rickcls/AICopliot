"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { Badge, Button, Select } from "@/components/ui";
import { TaskDependencies } from "@/components/task-dependencies";
import {
  BOARD_COLUMNS,
  isTaskOverdue,
  type TaskRow,
  type TaskStatus,
} from "@/components/task-types";
import { formatDay } from "@/lib/utils";

/**
 * Slide-over for one task.
 *
 * Exists so the card can show content instead of controls. It also carries the
 * status <select>, which is the keyboard-accessible equivalent of dragging a
 * card — the board is never drag-only.
 */
export function TaskDetail({
  task,
  allTasks,
  busy,
  onClose,
  onChangeStatus,
  onEdit,
  onDelete,
  onTaskChange,
  onError,
}: {
  task: TaskRow;
  allTasks: TaskRow[];
  busy: boolean;
  onClose: () => void;
  onChangeStatus: (status: TaskStatus) => void;
  onEdit: () => void;
  onDelete: () => void;
  onTaskChange: (task: TaskRow) => void;
  onError: (message: string | null) => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const blockedBy = task.dependencies.filter(
    (dependency) => dependency.dependsOnTask.status !== "done",
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close task details"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/30"
      />

      <div
        role="dialog"
        aria-label={`Task: ${task.title}`}
        aria-modal="true"
        className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
          <h2 className="text-base font-semibold text-pretty">{task.title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="flex-1 space-y-5 p-4">
          {task.description ? (
            <p className="text-sm text-pretty text-slate-700">
              {task.description}
            </p>
          ) : (
            <p className="text-sm text-slate-400 italic">No description.</p>
          )}

          <div>
            <label
              htmlFor="detail-status"
              className="mb-1 block text-xs font-medium text-slate-600"
            >
              Status
            </label>
            <Select
              id="detail-status"
              className="w-full"
              value={task.status}
              disabled={busy}
              onChange={(event) =>
                onChangeStatus(event.target.value as TaskStatus)
              }
            >
              {BOARD_COLUMNS.map((column) => (
                <option key={column.status} value={column.status}>
                  {column.label}
                </option>
              ))}
            </Select>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Priority</dt>
              <dd className="mt-0.5">
                <Badge
                  tone={
                    task.priority === "urgent"
                      ? "danger"
                      : task.priority === "high"
                        ? "warning"
                        : task.priority === "medium"
                          ? "info"
                          : "neutral"
                  }
                >
                  {task.priority}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Assignee</dt>
              <dd className="mt-0.5 truncate">
                {task.assignee?.name ?? task.assignee?.email ?? "Unassigned"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Start</dt>
              <dd className="mt-0.5">
                {task.startDate ? formatDay(task.startDate) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Due</dt>
              <dd
                className={
                  isTaskOverdue(task)
                    ? "mt-0.5 font-medium text-red-700"
                    : "mt-0.5"
                }
              >
                {task.dueDate ? formatDay(task.dueDate) : "—"}
                {isTaskOverdue(task) ? " · overdue" : ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Estimate</dt>
              <dd className="mt-0.5">
                {task.estimatedHours === null ? "—" : `${task.estimatedHours}h`}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Milestone</dt>
              <dd className="mt-0.5 truncate">
                {task.milestone?.title ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Origin</dt>
              <dd className="mt-0.5">
                <Badge tone={task.source === "manual" ? "neutral" : "info"}>
                  {task.source === "manual" ? "Manual" : "AI suggested"}
                </Badge>
              </dd>
            </div>
          </dl>

          {task.status !== "done" && blockedBy.length > 0 ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Waiting on {blockedBy.length} unfinished task
              {blockedBy.length === 1 ? "" : "s"}.
            </p>
          ) : null}

          <div>
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Dependencies
            </h3>
            <TaskDependencies
              task={task}
              allTasks={allTasks}
              onChange={onTaskChange}
              onError={onError}
            />
          </div>

          {task.citations.length > 0 ? (
            <div>
              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Sources
              </h3>
              <ul className="space-y-2">
                {task.citations.map((citation) => (
                  <li
                    key={citation.id}
                    className="rounded-lg border border-slate-200 p-2.5 text-xs"
                  >
                    <a
                      href={`/documents/${citation.chunk.document.id}`}
                      className="font-medium text-slate-800 underline hover:text-slate-950"
                    >
                      {citation.chunk.document.originalFilename}
                      {citation.chunk.pageNumber
                        ? ` · p.${citation.chunk.pageNumber}`
                        : ""}
                      {citation.chunk.sectionTitle
                        ? ` · ${citation.chunk.sectionTitle}`
                        : ""}
                    </a>
                    {citation.purpose === "milestone_link" ? (
                      <Badge tone="info" className="ml-1.5">
                        Milestone link
                      </Badge>
                    ) : null}
                    {citation.excerpt ? (
                      <p className="mt-1 text-slate-600 italic">
                        “{citation.excerpt}”
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="sticky bottom-0 flex gap-2 border-t border-slate-200 bg-white p-4">
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            onClick={onEdit}
            disabled={busy}
          >
            Edit
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="flex-1 border-red-200 text-red-700 hover:bg-red-50"
            onClick={onDelete}
            disabled={busy}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
