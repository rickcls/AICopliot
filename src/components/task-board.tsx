"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button, EmptyState, ErrorState } from "@/components/ui";
import { TaskCard } from "@/components/task-card";
import { TaskDetail } from "@/components/task-detail";
import { TaskForm, type TaskDraft, draftFrom, emptyDraft } from "@/components/task-form";
import {
  BOARD_COLUMNS,
  type MemberOption,
  type TaskRow,
  type TaskStatus,
} from "@/components/task-types";
import { cn } from "@/lib/utils";

export type { TaskRow } from "@/components/task-types";

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
}: {
  projectId: string;
  initialTasks: TaskRow[];
  members: MemberOption[];
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openTask = tasks.find((task) => task.id === openTaskId) ?? null;

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
          <h2 className="text-sm font-semibold">Board</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {tasks.length} task{tasks.length === 1 ? "" : "s"} · drag a card
            between columns to change its status
          </p>
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

      {error ? <ErrorState message={error} /> : null}

      {draft ? (
        <TaskForm
          draft={draft}
          members={members}
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
      ) : (
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
