"use client";

import { useState } from "react";
import {
  CalendarClock,
  ChevronRight,
  Flag,
  GitBranch,
  LayoutGrid,
  List,
  Plus,
  Timer,
} from "lucide-react";
import {
  Avatar,
  Button,
  EmptyState,
  ErrorState,
  FOCUS_RING,
  SectionHeader,
} from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
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

/**
 * Priority reads as a coloured flag rather than a text badge. In a list where
 * every row also carries a status, two same-shaped pills side by side compete
 * for the same glance; a flag is a different shape, so priority and status stop
 * fighting. `low` is deliberately near-invisible — the point of a priority
 * column is to find the urgent rows, not to label the ordinary ones.
 */
const PRIORITY_FLAG = {
  low: "text-slate-300",
  medium: "text-blue-500",
  high: "text-amber-500",
  urgent: "text-red-500",
} as const;

const PRIORITY_TEXT = {
  low: "text-slate-400",
  medium: "text-slate-600",
  high: "text-amber-700",
  urgent: "font-semibold text-red-700",
} as const;

const STATUS_DOT = {
  backlog: "bg-slate-400",
  todo: "bg-blue-500",
  in_progress: "bg-amber-500",
  blocked: "bg-red-500",
  done: "bg-emerald-500",
} as const;

/** Solid rather than pale: a group header is a divider, and has to out-weigh
 *  the rows under it or the list reads as one undifferentiated run. */
const STATUS_PILL = {
  backlog: "bg-slate-500",
  todo: "bg-blue-600",
  in_progress: "bg-amber-500",
  blocked: "bg-red-600",
  done: "bg-emerald-600",
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
  const [collapsedGroups, setCollapsedGroups] = useState<Set<TaskStatus>>(
    () => new Set(),
  );
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();
  const toast = useToast();

  const openTask = tasks.find((task) => task.id === openTaskId) ?? null;
  const filteredTasks =
    statusFilter === "all"
      ? tasks
      : tasks.filter((task) => task.status === statusFilter);

  /**
   * The list is grouped by status, in board order, so scrolling it tells the
   * same story as scanning the board left to right.
   *
   * Empty groups are dropped rather than rendered as headers with nothing under
   * them: a project with everything in Backlog would otherwise open on four
   * empty headings before its first task. The board already shows every status,
   * including the empty ones you can drop into.
   */
  const taskGroups = BOARD_COLUMNS.map((column) => ({
    status: column.status,
    label: column.label,
    tasks: filteredTasks.filter((task) => task.status === column.status),
  })).filter((group) => group.tasks.length > 0);

  function toggleGroup(status: TaskStatus) {
    setCollapsedGroups((previous) => {
      const next = new Set(previous);
      if (!next.delete(status)) next.add(status);
      return next;
    });
  }

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
    const confirmed = await confirm({
      title: `Delete “${task.title}”?`,
      body: blocks ? (
        <p>
          <span className="font-medium text-red-700">
            {blocks} task{blocks === 1 ? "" : "s"}
          </span>{" "}
          depend on it and will lose that dependency.
        </p>
      ) : undefined,
      confirmLabel: "Delete task",
      tone: "danger",
    });
    if (!confirmed) return;

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
      toast.success(`Deleted “${task.title}”`);
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
      <SectionHeader
        title={view === "board" ? "Board" : "Task list"}
        description={
          <>
            {tasks.length} task{tasks.length === 1 ? "" : "s"}
            {view === "board"
              ? " · drag a card between columns to change its status"
              : " · grouped by status"}
          </>
        }
      >
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
      </SectionHeader>

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
              {/* The Status column is gone: every row sits under a status
                  heading that already says it, and repeating it on each row was
                  a column of identical badges taking width from the one column
                  that needs it. The dot keeps the status legible for a row read
                  on its own. */}
              {/* `table-fixed` is what makes the title truncate instead of
                  forcing the table wider, so every column carries a width and
                  Task takes the remainder. None of them may be hidden by a
                  media query: the group header spans a fixed `colSpan`, and a
                  column that disappears below a breakpoint leaves a phantom one
                  behind that silently takes its width out of the Task column.
                  Below `min-w` the whole table scrolls sideways instead. */}
              <table className="w-full min-w-[720px] table-fixed border-collapse text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      Task
                    </th>
                    <th scope="col" className="w-40 px-3 py-2.5 font-medium">
                      Assignee
                    </th>
                    <th scope="col" className="w-28 px-3 py-2.5 font-medium">
                      Priority
                    </th>
                    <th scope="col" className="w-32 px-3 py-2.5 font-medium">
                      Due
                    </th>
                    <th
                      scope="col"
                      className="w-24 px-4 py-2.5 text-right font-medium"
                    >
                      Estimate
                    </th>
                  </tr>
                </thead>

                {taskGroups.map((group) => {
                  const collapsed = collapsedGroups.has(group.status);

                  return (
                    <tbody
                      key={group.status}
                      className="divide-y divide-slate-100 border-b border-slate-200 last:border-b-0"
                    >
                      <tr className="bg-slate-50/70">
                        <th
                          scope="colgroup"
                          colSpan={5}
                          className="px-2.5 py-1.5 text-left font-normal"
                        >
                          <button
                            type="button"
                            aria-expanded={!collapsed}
                            onClick={() => toggleGroup(group.status)}
                            className={cn(
                              "inline-flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-slate-200/70",
                              FOCUS_RING,
                            )}
                          >
                            <ChevronRight
                              aria-hidden
                              className={cn(
                                "size-3.5 shrink-0 text-slate-400 transition-transform",
                                !collapsed && "rotate-90",
                              )}
                            />
                            <span
                              className={cn(
                                "inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold tracking-wide text-white uppercase",
                                STATUS_PILL[group.status],
                              )}
                            >
                              {group.label}
                            </span>
                            <span className="text-xs text-slate-500 tabular-nums">
                              {group.tasks.length}
                            </span>
                          </button>
                        </th>
                      </tr>

                      {collapsed
                        ? null
                        : group.tasks.map((task) => {
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
                                  "group cursor-pointer transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-400",
                                  busyId === task.id &&
                                    "pointer-events-none opacity-60",
                                )}
                              >
                                <th
                                  scope="row"
                                  className="px-4 py-2.5 text-left font-normal"
                                >
                                  <span className="flex items-center gap-2.5">
                                    <span
                                      aria-hidden
                                      className={cn(
                                        "size-2 shrink-0 rounded-full",
                                        STATUS_DOT[task.status],
                                      )}
                                    />
                                    <span className="min-w-0 flex-1">
                                      {/* Truncation is what keeps a row one
                                          line tall; the title attribute is how
                                          a long one is still readable. */}
                                      <span
                                        title={task.title}
                                        className="block truncate font-medium text-slate-900 group-hover:underline"
                                      >
                                        {task.title}
                                      </span>
                                      {task.description ? (
                                        <span className="mt-0.5 block truncate text-xs text-slate-500">
                                          {task.description}
                                        </span>
                                      ) : null}
                                    </span>
                                    {task.dependencies.length > 0 ? (
                                      <span
                                        title={`Depends on ${task.dependencies.length} task(s)`}
                                        className="inline-flex shrink-0 items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 tabular-nums"
                                      >
                                        <GitBranch className="size-3" aria-hidden />
                                        {task.dependencies.length}
                                      </span>
                                    ) : null}
                                  </span>
                                </th>
                                <td className="px-3 py-2.5">
                                  {task.assignee ? (
                                    <span className="flex items-center gap-2">
                                      <Avatar
                                        name={task.assignee.name}
                                        email={task.assignee.email}
                                        className="size-5"
                                      />
                                      <span className="min-w-0 truncate text-xs text-slate-600">
                                        {task.assignee.name ?? task.assignee.email}
                                      </span>
                                    </span>
                                  ) : (
                                    <span className="text-xs text-slate-400">
                                      Unassigned
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2.5">
                                  <span
                                    className={cn(
                                      "inline-flex items-center gap-1.5 text-xs capitalize",
                                      PRIORITY_TEXT[task.priority],
                                    )}
                                  >
                                    <Flag
                                      aria-hidden
                                      fill="currentColor"
                                      className={cn(
                                        "size-3.5 shrink-0",
                                        PRIORITY_FLAG[task.priority],
                                      )}
                                    />
                                    {task.priority}
                                  </span>
                                </td>
                                <td
                                  className={cn(
                                    "px-3 py-2.5 text-xs whitespace-nowrap",
                                    overdue
                                      ? "font-medium text-red-700"
                                      : "text-slate-600",
                                  )}
                                >
                                  {task.dueDate ? (
                                    <span className="inline-flex items-center gap-1.5">
                                      <CalendarClock
                                        className="size-3.5 shrink-0"
                                        aria-hidden
                                      />
                                      {formatDay(task.dueDate)}
                                      {overdue ? " · overdue" : ""}
                                    </span>
                                  ) : (
                                    <span className="text-slate-300">—</span>
                                  )}
                                </td>
                                <td className="hidden px-4 py-2.5 text-right text-xs whitespace-nowrap text-slate-600 tabular-nums xl:table-cell">
                                  {task.estimatedHours === null ? (
                                    <span className="text-slate-300">—</span>
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
                  );
                })}
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
