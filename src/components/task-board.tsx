"use client";

import { useState } from "react";
import { CalendarClock, LayoutGrid, List, Plus, Timer } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState } from "@/components/ui";
import { TaskCard } from "@/components/task-card";
import { TaskDetail } from "@/components/task-detail";
import { TaskForm, type TaskDraft, draftFrom, emptyDraft } from "@/components/task-form";
import {
  BOARD_COLUMNS,
  isTaskOverdue,
  type MemberOption,
  type MilestoneOption,
  type TaskRow,
  type TaskStatus,
} from "@/components/task-types";
import { cn, formatDay } from "@/lib/utils";

export type { TaskRow } from "@/components/task-types";

type TaskView = "board" | "list";
type TaskStatusFilter = "all" | TaskStatus;

const PRIORITY_TONE = {
  low: "neutral",
  medium: "info",
  high: "warning",
  urgent: "danger",
} as const;

const STATUS_TONE = {
  backlog: "neutral",
  todo: "info",
  in_progress: "warning",
  blocked: "danger",
  done: "success",
} as const;

const STATUS_DOT = {
  backlog: "bg-slate-400",
  todo: "bg-blue-500",
  in_progress: "bg-amber-500",
  blocked: "bg-red-500",
  done: "bg-emerald-500",
} as const;

function statusLabel(status: TaskStatus): string {
  return BOARD_COLUMNS.find((column) => column.status === status)?.label ?? status;
}

/**
 * Kanban board.
 *
 * Drag-and-drop uses native HTML5 drag events rather than a library — moving a
 * card between columns is a single status change, which does not justify a new
 * dependency. The status dropdown in the detail panel remains the keyboard and
 * assistive-technology path, so nothing is drag-only.
 */
export function TaskBoard({
  projectId,
  initialTasks,
  members,
  milestones,
}: {
  projectId: string;
  initialTasks: TaskRow[];
  members: MemberOption[];
  milestones: MilestoneOption[];
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [view, setView] = useState<TaskView>("board");
  const [statusFilter, setStatusFilter] =
    useState<TaskStatusFilter>("all");
  const [error, setError] = useState<string | null>(null);

  const openTask = tasks.find((task) => task.id === openTaskId) ?? null;
  const filteredTasks =
    statusFilter === "all"
      ? tasks
      : tasks.filter((task) => task.status === statusFilter);

  function upsert(task: TaskRow) {
    setTasks((previous) =>
      previous.some((item) => item.id === task.id)
        ? previous.map((item) => (item.id === task.id ? task : item))
        : [...previous, task],
    );
  }

  async function saveDraft(payload: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const editing = editingId !== null;
      const response = await fetch(
        editing ? `/api/tasks/${editingId}` : `/api/projects/${projectId}/tasks`,
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Could not save the task.");
        return;
      }
      upsert(data.task);
      setDraft(null);
      setEditingId(null);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Moves optimistically so the card lands where it was dropped, then reconciles
   * with the server response — or rolls back, because a card silently sitting in
   * the wrong column is worse than a visible error.
   */
  async function changeStatus(task: TaskRow, status: TaskStatus) {
    if (task.status === status) return;
    const previousStatus = task.status;

    setTasks((previous) =>
      previous.map((item) => (item.id === task.id ? { ...item, status } : item)),
    );
    setBusyId(task.id);
    setError(null);

    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setTasks((previous) =>
          previous.map((item) =>
            item.id === task.id ? { ...item, status: previousStatus } : item,
          ),
        );
        setError(data.error ?? "Could not move that task.");
        return;
      }
      upsert(data.task);
    } catch {
      setTasks((previous) =>
        previous.map((item) =>
          item.id === task.id ? { ...item, status: previousStatus } : item,
        ),
      );
      setError("Could not reach the server.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteTask(task: TaskRow) {
    const blocks = tasks.filter((item) =>
      item.dependencies.some((d) => d.dependsOnTaskId === task.id),
    ).length;
    const warning = blocks
      ? `Delete "${task.title}"?\n\n${blocks} task(s) depend on it and will lose that dependency.`
      : `Delete "${task.title}"?`;
    if (!confirm(warning)) return;

    setBusyId(task.id);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? "Could not delete the task.");
        return;
      }
      setTasks((previous) =>
        previous
          .filter((item) => item.id !== task.id)
          .map((item) => ({
            ...item,
            dependencies: item.dependencies.filter(
              (d) => d.dependsOnTaskId !== task.id,
            ),
          })),
      );
      setOpenTaskId(null);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusyId(null);
    }
  }

  /**
   * The dragged id comes from the dataTransfer rather than component state:
   * state set in `dragstart` is not guaranteed to have been committed by the
   * time `drop` runs, and the transfer is the browser's own record of what is
   * being dragged.
   */
  function handleDrop(status: TaskStatus, transferred: string) {
    setDragOverStatus(null);
    const id = transferred || draggingId;
    const task = tasks.find((item) => item.id === id);
    setDraggingId(null);
    if (task) void changeStatus(task, status);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">
            {view === "board" ? "Board" : "Task list"}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {tasks.length} task{tasks.length === 1 ? "" : "s"}
            {view === "board"
              ? " · drag a card between columns to change its status"
              : " · review every task in one place"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5"
            aria-label="Task view"
            role="group"
          >
            <button
              type="button"
              aria-pressed={view === "board"}
              onClick={() => setView("board")}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                view === "board"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-900",
              )}
            >
              <LayoutGrid className="size-3.5" aria-hidden />
              Board
            </button>
            <button
              type="button"
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                view === "list"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-900",
              )}
            >
              <List className="size-3.5" aria-hidden />
              List
            </button>
          </div>
          <Button
            type="button"
            onClick={() => {
              setEditingId(null);
              setDraft(emptyDraft("backlog"));
            }}
          >
            <Plus className="size-4" aria-hidden />
            New task
          </Button>
        </div>
      </div>

      {error ? <ErrorState message={error} /> : null}

      {draft ? (
        <TaskForm
          draft={draft}
          members={members}
          milestones={milestones}
          saving={saving}
          editing={editingId !== null}
          onChange={setDraft}
          onCancel={() => {
            setDraft(null);
            setEditingId(null);
          }}
          onSubmit={saveDraft}
        />
      ) : null}

      {tasks.length === 0 && !draft ? (
        <EmptyState
          title="No tasks yet"
          description="Break the work in this project's documents into tasks. Every task here is one you entered — nothing is generated."
          action={
            <Button
              type="button"
              onClick={() => {
                setEditingId(null);
                setDraft(emptyDraft("backlog"));
              }}
            >
              Create the first task
            </Button>
          }
        />
      ) : view === "board" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {BOARD_COLUMNS.map((column) => {
            const columnTasks = tasks.filter(
              (task) => task.status === column.status,
            );
            const isTarget = dragOverStatus === column.status;

            return (
              <section
                key={column.status}
                aria-label={column.label}
                onDragOver={(event) => {
                  // Preventing default is what marks this a valid drop target.
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  if (dragOverStatus !== column.status) {
                    setDragOverStatus(column.status);
                  }
                }}
                onDragLeave={(event) => {
                  // Ignore bubbling from children, or the highlight flickers.
                  if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                    setDragOverStatus(null);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  handleDrop(
                    column.status,
                    event.dataTransfer.getData("text/plain"),
                  );
                }}
                className={cn(
                  "flex min-h-40 flex-col rounded-xl border border-transparent bg-slate-50 p-2 transition-colors",
                  isTarget && "border-slate-400 border-dashed bg-slate-100",
                )}
              >
                <div className="flex items-center justify-between px-1.5 pt-0.5 pb-2">
                  <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    {column.label}
                  </h3>
                  <span className="rounded-full bg-white px-1.5 text-xs text-slate-500 tabular-nums">
                    {columnTasks.length}
                  </span>
                </div>

                <div className="flex-1 space-y-2">
                  {columnTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      dragging={draggingId === task.id}
                      busy={busyId === task.id}
                      onOpen={() => setOpenTaskId(task.id)}
                      onDragStart={() => setDraggingId(task.id)}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDragOverStatus(null);
                      }}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setDraft(emptyDraft(column.status));
                  }}
                  className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-white hover:text-slate-900"
                >
                  <Plus className="size-3.5" aria-hidden />
                  Add
                </button>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div
            role="group"
            aria-label="Filter task list by status"
            className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-slate-50/60 px-3 py-2.5"
          >
            <button
              type="button"
              aria-pressed={statusFilter === "all"}
              onClick={() => setStatusFilter("all")}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
                statusFilter === "all"
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900",
              )}
            >
              All
              <span
                className={cn(
                  "tabular-nums",
                  statusFilter === "all" ? "text-slate-300" : "text-slate-400",
                )}
              >
                {tasks.length}
              </span>
            </button>
            {BOARD_COLUMNS.map((column) => {
              const count = tasks.filter(
                (task) => task.status === column.status,
              ).length;
              const selected = statusFilter === column.status;

              return (
                <button
                  key={column.status}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setStatusFilter(column.status)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
                    selected
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn("size-1.5 rounded-full", STATUS_DOT[column.status])}
                  />
                  {column.label}
                  <span
                    className={cn(
                      "tabular-nums",
                      selected ? "text-slate-300" : "text-slate-400",
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {filteredTasks.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm font-medium text-slate-900">
                No {statusFilter === "all" ? "" : statusLabel(statusFilter).toLowerCase() + " "}
                tasks
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Choose another status to see its tasks.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm xl:min-w-[760px]">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Task
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Priority
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Assignee
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Due
                  </th>
                  <th
                    scope="col"
                    className="hidden px-4 py-3 text-right font-medium xl:table-cell"
                  >
                    Estimate
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTasks.map((task) => {
                  const overdue = isTaskOverdue(task);

                  return (
                    <tr
                      key={task.id}
                      tabIndex={busyId === task.id ? -1 : 0}
                      aria-label={`Open ${task.title} details`}
                      title="Open task details"
                      onClick={() => setOpenTaskId(task.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setOpenTaskId(task.id);
                        }
                      }}
                      className={cn(
                        "group cursor-pointer transition-colors hover:bg-slate-50/80 focus-visible:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-400",
                        busyId === task.id && "pointer-events-none opacity-60",
                      )}
                    >
                      <th scope="row" className="max-w-sm px-4 py-3 font-normal">
                        <span className="line-clamp-2 font-medium text-slate-900 group-hover:underline">
                          {task.title}
                        </span>
                        {task.description ? (
                          <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">
                            {task.description}
                          </p>
                        ) : null}
                      </th>
                      <td className="px-3 py-3">
                        <Badge tone={STATUS_TONE[task.status]}>
                          {statusLabel(task.status)}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={PRIORITY_TONE[task.priority]}>
                          {task.priority}
                        </Badge>
                      </td>
                      <td className="max-w-40 truncate px-3 py-3 text-slate-600">
                        {task.assignee?.name ?? task.assignee?.email ?? "Unassigned"}
                      </td>
                      <td
                        className={cn(
                          "whitespace-nowrap px-3 py-3 text-slate-600",
                          overdue && "font-medium text-red-700",
                        )}
                      >
                        {task.dueDate ? (
                          <span className="inline-flex items-center gap-1.5">
                            <CalendarClock className="size-3.5" aria-hidden />
                            {formatDay(task.dueDate)}
                            {overdue ? " · overdue" : ""}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="hidden whitespace-nowrap px-4 py-3 text-right text-slate-600 tabular-nums xl:table-cell">
                        {task.estimatedHours === null ? (
                          "—"
                        ) : (
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <Timer className="size-3.5" aria-hidden />
                            {task.estimatedHours}h
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {openTask ? (
        <TaskDetail
          task={openTask}
          allTasks={tasks}
          busy={busyId === openTask.id}
          onClose={() => setOpenTaskId(null)}
          onChangeStatus={(status) => void changeStatus(openTask, status)}
          onEdit={() => {
            setEditingId(openTask.id);
            setDraft(draftFrom(openTask));
            setOpenTaskId(null);
          }}
          onDelete={() => void deleteTask(openTask)}
          onTaskChange={upsert}
          onError={setError}
        />
      ) : null}
    </div>
  );
}
