"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  Columns3,
  LayoutGrid,
  List,
  Plus,
  Trash2,
} from "lucide-react";
import {
  Button,
  EmptyState,
  ErrorState,
  FOCUS_RING,
  Input,
  SectionHeader,
  Select,
} from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { TaskCard } from "@/components/task-card";
import { TaskDetail } from "@/components/task-detail";
import { TaskForm, type TaskDraft, emptyDraft } from "@/components/task-form";
import { TaskFilterBar } from "@/components/task-filter-bar";
import { TaskListRow } from "@/components/task-list-row";
import {
  STATUS_DOT,
  STATUS_PILL,
  statusColorToken,
  type MemberOption,
  type MilestoneOption,
  type TaskRow,
  type TaskStatusCategory,
  type TaskStatusOption,
} from "@/components/task-types";
import {
  EMPTY_TASK_FILTER,
  isTaskFilterActive,
  matchesTaskQuickFilter,
  taskMatches,
  TASK_QUICK_FILTERS,
  type TaskFilter,
  type TaskQuickFilter,
} from "@/lib/pm/filters";
import { cn } from "@/lib/utils";

export type { TaskRow } from "@/components/task-types";

type TaskView = "board" | "list";
type StatusFilter = "all" | string;

/**
 * Tailwind needs the full class names in source — dynamic `grid-cols-${n}` is
 * purged, so the map is the only safe way to size the board to the columns.
 */
const BOARD_GRID: Record<number, string> = {
  1: "xl:grid-cols-1",
  2: "xl:grid-cols-2",
  3: "xl:grid-cols-3",
  4: "xl:grid-cols-4",
  5: "xl:grid-cols-5",
  6: "xl:grid-cols-6",
  7: "xl:grid-cols-7",
  8: "xl:grid-cols-8",
};

const CATEGORY_LABEL: Record<TaskStatusCategory, string> = {
  open: "Open",
  blocked: "Blocked",
  done: "Done",
};

/**
 * Kanban board + list over project-scoped statuses.
 *
 * Columns are `ProjectTaskStatus` rows — users can create and delete them.
 * Category (open | blocked | done) is what overdue and completion key off;
 * the label is free text.
 *
 * Drag-and-drop uses native HTML5 drag events. The status dropdown in the
 * detail panel remains the keyboard path. List rows drag from a grip handle
 * so click-to-open does not fight the drag.
 */
export function TaskBoard({
  projectId,
  initialTasks,
  initialStatuses,
  members,
  milestones,
  currentUserId,
  initialOpenTaskId = null,
  initialQuickFilter = null,
  nowIso,
}: {
  projectId: string;
  initialTasks: TaskRow[];
  initialStatuses: TaskStatusOption[];
  members: MemberOption[];
  milestones: MilestoneOption[];
  currentUserId: string;
  initialOpenTaskId?: string | null;
  /** From `?filter=`, so an Overview card can land on the rows it counted. */
  initialQuickFilter?: TaskQuickFilter | null;
  /**
   * From the server, like the timeline's: overdue computed from the client
   * clock at hydration could disagree with the server render across midnight.
   */
  nowIso: string;
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [statuses, setStatuses] = useState(initialStatuses);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // A dashboard link arrives as ?task=. Ignore an id this project does not
  // have so a stale link does not open an empty panel.
  const [openTaskId, setOpenTaskId] = useState<string | null>(() =>
    initialOpenTaskId && initialTasks.some((task) => task.id === initialOpenTaskId)
      ? initialOpenTaskId
      : null,
  );
  const [saving, setSaving] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [draggingIds, setDraggingIds] = useState<string[]>([]);
  const [dragOverStatusId, setDragOverStatusId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [view, setView] = useState<TaskView>("board");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [filter, setFilter] = useState<TaskFilter>(() => ({
    ...EMPTY_TASK_FILTER,
    quick: initialQuickFilter,
  }));
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const [statusesOpen, setStatusesOpen] = useState(false);
  const [newStatusLabel, setNewStatusLabel] = useState("");
  const [newStatusCategory, setNewStatusCategory] =
    useState<TaskStatusCategory>("open");
  const [creatingStatus, setCreatingStatus] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statusesMenuRef = useRef<HTMLDivElement>(null);
  const lastSelectedIdRef = useRef<string | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();
  const toast = useToast();

  useEffect(() => {
    if (!statusesOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (
        statusesMenuRef.current &&
        !statusesMenuRef.current.contains(event.target as Node)
      ) {
        setStatusesOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setStatusesOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [statusesOpen]);

  const openTask = tasks.find((task) => task.id === openTaskId) ?? null;
  const defaultStatusId =
    statuses.find((status) => status.isDefault)?.id ??
    statuses[0]?.id ??
    "";

  const filterContext = useMemo(
    () => ({ now: new Date(nowIso), currentUserId }),
    [nowIso, currentUserId],
  );
  const filterActive = isTaskFilterActive(filter);
  // Both views draw from this, so switching Board/List keeps the same rows.
  const matchingTasks = filterActive
    ? tasks.filter((task) => taskMatches(task, filter, filterContext))
    : tasks;
  const quickCounts = Object.fromEntries(
    TASK_QUICK_FILTERS.map((quick) => [
      quick,
      tasks.filter((task) => matchesTaskQuickFilter(task, quick, filterContext))
        .length,
    ]),
  ) as Record<TaskQuickFilter, number>;

  const filteredTasks =
    statusFilter === "all"
      ? matchingTasks
      : matchingTasks.filter((task) => task.statusId === statusFilter);

  const taskGroups = (
    statusFilter === "all"
      ? statuses
      : statuses.filter((status) => status.id === statusFilter)
  ).map((status) => ({
    status,
    tasks: filteredTasks.filter((task) => task.statusId === status.id),
  }));

  function toggleGroup(statusId: string) {
    setCollapsedGroups((previous) => {
      const next = new Set(previous);
      if (!next.delete(statusId)) next.add(statusId);
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

  function upsertStatus(status: TaskStatusOption) {
    setStatuses((previous) => {
      const without = previous.filter((item) => item.id !== status.id);
      const next = [...without, status].sort(
        (a, b) => a.position - b.position,
      );
      return status.isDefault
        ? next.map((item) =>
            item.id === status.id ? item : { ...item, isDefault: false },
          )
        : next;
    });
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

  async function changeStatus(task: TaskRow, statusId: string) {
    await moveTasks([task.id], statusId);
  }

  async function moveTasks(taskIds: string[], statusId: string) {
    const nextStatus = statuses.find((status) => status.id === statusId);
    if (!nextStatus) return;

    const movers = tasks.filter(
      (task) => taskIds.includes(task.id) && task.statusId !== statusId,
    );
    if (movers.length === 0) return;

    const previousById = new Map(movers.map((task) => [task.id, task]));
    const moverIds = new Set(movers.map((task) => task.id));

    setTasks((current) =>
      current.map((item) =>
        moverIds.has(item.id)
          ? { ...item, statusId, status: nextStatus }
          : item,
      ),
    );
    setBusyIds(moverIds);
    setError(null);

    const failures: string[] = [];
    const succeeded: TaskRow[] = [];
    await Promise.all(
      movers.map(async (task) => {
        try {
          const response = await fetch(`/api/tasks/${task.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ statusId }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || !data.task) {
            failures.push(task.id);
            return;
          }
          succeeded.push(data.task);
        } catch {
          failures.push(task.id);
        }
      }),
    );

    if (succeeded.length > 0) {
      const byId = new Map(succeeded.map((task) => [task.id, task]));
      setTasks((current) =>
        current.map((item) => byId.get(item.id) ?? item),
      );
    }

    if (failures.length > 0) {
      setTasks((current) =>
        current.map((item) =>
          failures.includes(item.id)
            ? (previousById.get(item.id) ?? item)
            : item,
        ),
      );
      setError(
        failures.length === movers.length
          ? "Could not move the selected tasks."
          : `Could not move ${failures.length} of ${movers.length} tasks.`,
      );
    }

    setBusyIds(new Set());
  }

  async function deleteTask(task: TaskRow) {
    await deleteTasks([task.id]);
  }

  async function deleteTasks(taskIds: string[]) {
    const targets = tasks.filter((task) => taskIds.includes(task.id));
    if (targets.length === 0) return;

    const blocks = tasks.filter((item) =>
      item.dependencies.some((d) => taskIds.includes(d.dependsOnTaskId)),
    ).length;

    const confirmed = await confirm({
      title:
        targets.length === 1
          ? `Delete “${targets[0].title}”?`
          : `Delete ${targets.length} tasks?`,
      body: blocks ? (
        <p>
          <span className="font-medium text-red-700">
            {blocks} task{blocks === 1 ? "" : "s"}
          </span>{" "}
          depend on {targets.length === 1 ? "it" : "a selected task"} and will
          lose that dependency.
        </p>
      ) : undefined,
      confirmLabel: targets.length === 1 ? "Delete task" : "Delete tasks",
      tone: "danger",
    });
    if (!confirmed) return;

    const targetIds = new Set(targets.map((task) => task.id));
    setBusyIds(targetIds);
    setError(null);

    const deleted: string[] = [];
    const failures: string[] = [];
    await Promise.all(
      targets.map(async (task) => {
        try {
          const response = await fetch(`/api/tasks/${task.id}`, {
            method: "DELETE",
          });
          if (!response.ok) {
            failures.push(task.id);
            return;
          }
          deleted.push(task.id);
        } catch {
          failures.push(task.id);
        }
      }),
    );

    if (deleted.length > 0) {
      const deletedSet = new Set(deleted);
      setTasks((previous) =>
        previous
          .filter((item) => !deletedSet.has(item.id))
          .map((item) => ({
            ...item,
            dependencies: item.dependencies.filter(
              (d) => !deletedSet.has(d.dependsOnTaskId),
            ),
          })),
      );
      setSelectedIds((previous) => {
        const next = new Set(previous);
        for (const id of deleted) next.delete(id);
        return next;
      });
      if (openTaskId && deletedSet.has(openTaskId)) setOpenTaskId(null);
      toast.success(
        deleted.length === 1
          ? `Deleted “${targets.find((task) => task.id === deleted[0])?.title}”`
          : `Deleted ${deleted.length} tasks`,
      );
    }

    if (failures.length > 0) {
      setError(
        failures.length === targets.length
          ? "Could not delete the selected tasks."
          : `Could not delete ${failures.length} of ${targets.length} tasks.`,
      );
    }

    setBusyIds(new Set());
  }

  async function createStatus() {
    const label = newStatusLabel.trim();
    if (!label || creatingStatus) return;
    setCreatingStatus(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/task-statuses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          category: newStatusCategory,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Could not create the status.");
        return;
      }
      upsertStatus(data.status);
      setNewStatusLabel("");
      setNewStatusCategory("open");
      toast.success(`Added “${data.status.label}”`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setCreatingStatus(false);
    }
  }

  async function removeStatus(status: TaskStatusOption) {
    const taskCount = tasks.filter((task) => task.statusId === status.id).length;
    if (taskCount > 0) {
      setError(
        `Move or delete the ${taskCount} task${
          taskCount === 1 ? "" : "s"
        } in “${status.label}” before removing it.`,
      );
      return;
    }

    const confirmed = await confirm({
      title: `Remove “${status.label}”?`,
      body: (
        <p>
          This removes the column from the board and list. You need at least one
          Open and one Done status.
        </p>
      ),
      confirmLabel: "Remove status",
      tone: "danger",
    });
    if (!confirmed) return;

    setStatusBusyId(status.id);
    setError(null);
    try {
      const response = await fetch(`/api/task-statuses/${status.id}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Could not remove the status.");
        return;
      }
      setStatuses((previous) => previous.filter((item) => item.id !== status.id));
      if (statusFilter === status.id) setStatusFilter("all");
      toast.success(`Removed “${status.label}”`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setStatusBusyId(null);
    }
  }

  function handleDrop(statusId: string, transferred: string) {
    setDragOverStatusId(null);
    const fromTransfer = transferred
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const ids = fromTransfer.length > 0 ? fromTransfer : draggingIds;
    setDraggingIds([]);
    if (ids.length > 0) void moveTasks(ids, statusId);
  }

  function groupDropHandlers(statusId: string) {
    return {
      onDragOver: (event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (dragOverStatusId !== statusId) setDragOverStatusId(statusId);
      },
      onDragLeave: (event: React.DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setDragOverStatusId(null);
        }
      },
      onDrop: (event: React.DragEvent) => {
        event.preventDefault();
        handleDrop(statusId, event.dataTransfer.getData("text/plain"));
      },
    };
  }

  const visibleTaskIds = taskGroups.flatMap((group) =>
    group.tasks.map((task) => task.id),
  );
  const allVisibleSelected =
    visibleTaskIds.length > 0 &&
    visibleTaskIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleTaskIds.some((id) => selectedIds.has(id));

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate =
      someVisibleSelected && !allVisibleSelected;
  }, [someVisibleSelected, allVisibleSelected]);

  function toggleSelect(taskId: string, shiftKey: boolean) {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (shiftKey && lastSelectedIdRef.current) {
        const start = visibleTaskIds.indexOf(lastSelectedIdRef.current);
        const end = visibleTaskIds.indexOf(taskId);
        if (start >= 0 && end >= 0) {
          const [from, to] = start < end ? [start, end] : [end, start];
          for (let index = from; index <= to; index += 1) {
            next.add(visibleTaskIds[index]);
          }
          return next;
        }
      }
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
    lastSelectedIdRef.current = taskId;
  }

  function toggleSelectAll() {
    setSelectedIds((previous) => {
      if (allVisibleSelected) {
        const next = new Set(previous);
        for (const id of visibleTaskIds) next.delete(id);
        return next;
      }
      const next = new Set(previous);
      for (const id of visibleTaskIds) next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    lastSelectedIdRef.current = null;
  }

  function openCreate(statusId: string = defaultStatusId) {
    if (!statusId) return;
    setEditingId(null);
    setDraft(emptyDraft(statusId));
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
              : " · double-click a value to edit · open icon for details"}
          </>
        }
      >
        <div className="flex items-center gap-2">
          {/* One segmented control for view + status columns. Statuses used to
              be a separate bordered Button beside List, which read as a second
              view toggle competing with Board/List rather than a column
              manager for the same statuses the board already shows. */}
          <div ref={statusesMenuRef} className="relative">
            <div
              className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5"
              aria-label="Task view"
              role="group"
            >
              <button
                type="button"
                aria-pressed={view === "board"}
                onClick={() => {
                  setView("board");
                  setStatusesOpen(false);
                  clearSelection();
                }}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                  view === "board" && !statusesOpen
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
                onClick={() => {
                  setView("list");
                  setStatusesOpen(false);
                }}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                  view === "list" && !statusesOpen
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-900",
                )}
              >
                <List className="size-3.5" aria-hidden />
                List
              </button>
              <button
                type="button"
                aria-expanded={statusesOpen}
                aria-haspopup="dialog"
                aria-pressed={statusesOpen}
                onClick={() => setStatusesOpen((open) => !open)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                  statusesOpen
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-900",
                )}
              >
                <Columns3 className="size-3.5" aria-hidden />
                Statuses
              </button>
            </div>
            {statusesOpen ? (
              <div
                role="dialog"
                aria-label="Manage statuses"
                className="absolute right-0 z-20 mt-1.5 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
              >
                <p className="px-1 text-xs text-slate-500">
                  Add or remove board columns. Every project needs at least one
                  Open and one Done status.
                </p>
                <ul className="mt-2 max-h-56 space-y-0.5 overflow-y-auto">
                  {statuses.map((status) => {
                    const tone = statusColorToken(status);
                    const taskCount = tasks.filter(
                      (task) => task.statusId === status.id,
                    ).length;
                    return (
                      <li
                        key={status.id}
                        className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
                      >
                        <span
                          aria-hidden
                          className={cn("size-1.5 rounded-full", STATUS_DOT[tone])}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm text-slate-800">
                          {status.label}
                          <span className="ml-1.5 text-[11px] text-slate-400">
                            {CATEGORY_LABEL[status.category]}
                            {taskCount > 0 ? ` · ${taskCount}` : ""}
                          </span>
                        </span>
                        <button
                          type="button"
                          disabled={statusBusyId === status.id}
                          aria-label={`Remove ${status.label}`}
                          onClick={() => void removeStatus(status)}
                          className={cn(
                            "inline-flex size-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-700 disabled:opacity-50",
                            FOCUS_RING,
                          )}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <form
                  className="mt-2 space-y-2 border-t border-slate-100 pt-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void createStatus();
                  }}
                >
                  <Input
                    value={newStatusLabel}
                    onChange={(event) => setNewStatusLabel(event.target.value)}
                    placeholder="New status name"
                    maxLength={40}
                    disabled={creatingStatus}
                    aria-label="New status name"
                    className="h-8 text-sm"
                  />
                  <div className="flex gap-2">
                    <Select
                      value={newStatusCategory}
                      onChange={(event) =>
                        setNewStatusCategory(
                          event.target.value as TaskStatusCategory,
                        )
                      }
                      disabled={creatingStatus}
                      aria-label="Status category"
                      className="h-8 flex-1 text-xs"
                    >
                      <option value="open">Open</option>
                      <option value="blocked">Blocked</option>
                      <option value="done">Done</option>
                    </Select>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={creatingStatus || newStatusLabel.trim() === ""}
                    >
                      <Plus className="size-3.5" aria-hidden />
                      Add
                    </Button>
                  </div>
                </form>
              </div>
            ) : null}
          </div>

          <Button type="button" onClick={() => openCreate()} disabled={!defaultStatusId}>
            <Plus className="size-4" aria-hidden />
            New task
          </Button>
        </div>
      </SectionHeader>

      {error ? <ErrorState message={error} /> : null}

      {tasks.length > 0 ? (
        <TaskFilterBar
          filter={filter}
          onChange={(next) => {
            setFilter(next);
            clearSelection();
          }}
          counts={quickCounts}
          milestones={milestones}
          shown={matchingTasks.length}
          total={tasks.length}
        />
      ) : null}

      {tasks.length === 0 ? (
        <EmptyState
          title="No tasks yet"
          description="Break the work in this project's documents into tasks. Every task here is one you entered — nothing is generated."
          action={
            <Button
              type="button"
              onClick={() => openCreate()}
              disabled={!defaultStatusId}
            >
              Create the first task
            </Button>
          }
        />
      ) : filterActive && matchingTasks.length === 0 ? (
        <EmptyState
          title="No tasks match these filters"
          description="Nothing in this project fits every filter at once. Clear them to see the whole board."
          action={
            <Button
              type="button"
              variant="secondary"
              onClick={() => setFilter(EMPTY_TASK_FILTER)}
            >
              Clear filters
            </Button>
          }
        />
      ) : view === "board" ? (
        <div
          className={cn(
            "grid grid-cols-1 gap-3 sm:grid-cols-2",
            BOARD_GRID[Math.min(statuses.length, 8)] ?? "xl:grid-cols-5",
          )}
        >
          {statuses.map((status) => {
            const columnTasks = matchingTasks.filter(
              (task) => task.statusId === status.id,
            );
            const isTarget = dragOverStatusId === status.id;
            const tone = statusColorToken(status);

            return (
              <section
                key={status.id}
                aria-label={status.label}
                {...groupDropHandlers(status.id)}
                className={cn(
                  "flex min-h-40 flex-col rounded-xl border border-transparent bg-slate-50 p-2 transition-colors",
                  isTarget && "border-slate-400 border-dashed bg-slate-100",
                )}
              >
                <div className="flex items-center justify-between gap-2 px-1.5 pt-0.5 pb-2">
                  <h3 className="flex min-w-0 items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    <span
                      aria-hidden
                      className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[tone])}
                    />
                    <span className="truncate">{status.label}</span>
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
                      dragging={draggingIds.includes(task.id)}
                      busy={busyIds.has(task.id)}
                      onOpen={() => setOpenTaskId(task.id)}
                      onDragStart={() => setDraggingIds([task.id])}
                      onDragEnd={() => {
                        setDraggingIds([]);
                        setDragOverStatusId(null);
                      }}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => openCreate(status.id)}
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
                {matchingTasks.length}
              </span>
            </button>
            {statuses.map((status) => {
              const count = matchingTasks.filter(
                (task) => task.statusId === status.id,
              ).length;
              const selected = statusFilter === status.id;
              const tone = statusColorToken(status);

              return (
                <button
                  key={status.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setStatusFilter(status.id)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
                    selected
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn("size-1.5 rounded-full", STATUS_DOT[tone])}
                  />
                  {status.label}
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

          {selectedIds.size > 0 ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-100 px-3 py-2">
              <span className="text-xs font-medium text-slate-700">
                {selectedIds.size} selected
              </span>
              <Select
                aria-label="Move selected tasks to status"
                className="h-8 text-xs"
                defaultValue=""
                disabled={busyIds.size > 0}
                onChange={(event) => {
                  const statusId = event.target.value;
                  event.target.value = "";
                  if (!statusId) return;
                  void moveTasks([...selectedIds], statusId);
                }}
              >
                <option value="" disabled>
                  Move to…
                </option>
                {statuses.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.label}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                size="sm"
                variant="danger"
                disabled={busyIds.size > 0}
                onClick={() => void deleteTasks([...selectedIds])}
              >
                Delete
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={clearSelection}
              >
                Clear
              </Button>
            </div>
          ) : null}

          {taskGroups.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm font-medium text-slate-900">No statuses yet</p>
              <p className="mt-1 text-xs text-slate-500">
                Add a status to start organising work.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] table-fixed border-collapse text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th scope="col" className="w-10 px-2 py-2.5">
                      <span className="sr-only">Select</span>
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAll}
                        aria-label="Select all visible tasks"
                        className="size-3.5 rounded border-slate-300 text-slate-900 focus-visible:ring-slate-900"
                      />
                    </th>
                    <th scope="col" className="w-8 px-1 py-2.5">
                      <span className="sr-only">Drag</span>
                    </th>
                    <th scope="col" className="px-2 py-2.5 font-medium">
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
                  const collapsed = collapsedGroups.has(group.status.id);
                  const isTarget = dragOverStatusId === group.status.id;
                  const tone = statusColorToken(group.status);

                  return (
                    <tbody
                      key={group.status.id}
                      {...groupDropHandlers(group.status.id)}
                      className={cn(
                        "divide-y divide-slate-100 border-b border-slate-200 last:border-b-0",
                        isTarget &&
                          "bg-slate-100/80 outline outline-dashed outline-slate-400 -outline-offset-2",
                      )}
                    >
                      <tr className="bg-slate-50/70">
                        <th
                          scope="colgroup"
                          colSpan={7}
                          className="px-2.5 py-1.5 text-left font-normal"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              aria-expanded={!collapsed}
                              onClick={() => toggleGroup(group.status.id)}
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
                                  STATUS_PILL[tone],
                                )}
                              >
                                {group.status.label}
                              </span>
                              <span className="text-xs text-slate-500 tabular-nums">
                                {group.tasks.length}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => openCreate(group.status.id)}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-200/70 hover:text-slate-900",
                                FOCUS_RING,
                              )}
                            >
                              <Plus className="size-3.5" aria-hidden />
                              Add
                            </button>
                          </div>
                        </th>
                      </tr>

                      {collapsed
                        ? null
                        : group.tasks.map((task) => (
                            <TaskListRow
                              key={task.id}
                              task={task}
                              members={members}
                              selected={selectedIds.has(task.id)}
                              selectedCount={selectedIds.size}
                              dragging={draggingIds.includes(task.id)}
                              busy={busyIds.has(task.id)}
                              onToggleSelect={(shiftKey) =>
                                toggleSelect(task.id, shiftKey)
                              }
                              onOpen={() => setOpenTaskId(task.id)}
                              onTaskChange={upsert}
                              onError={setError}
                              onDragStart={(event) => {
                                event.stopPropagation();
                                const ids =
                                  selectedIds.has(task.id) &&
                                  selectedIds.size > 1
                                    ? [...selectedIds]
                                    : [task.id];
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData(
                                  "text/plain",
                                  ids.join(","),
                                );
                                setDraggingIds(ids);
                              }}
                              onDragEnd={() => {
                                setDraggingIds([]);
                                setDragOverStatusId(null);
                              }}
                            />
                          ))}

                      {!collapsed && group.tasks.length === 0 ? (
                        <tr>
                          <td
                            colSpan={7}
                            className="px-4 py-6 text-center text-xs text-slate-400"
                          >
                            Drop a task here, or add one.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  );
                })}
              </table>
            </div>
          )}
        </div>
      )}

      {draft ? (
        <TaskForm
          draft={draft}
          statuses={statuses}
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

      {openTask ? (
        <TaskDetail
          key={openTask.id}
          task={openTask}
          allTasks={tasks}
          statuses={statuses}
          members={members}
          milestones={milestones}
          currentUserId={currentUserId}
          busy={busyIds.has(openTask.id)}
          onClose={() => setOpenTaskId(null)}
          onExpand={(nextDraft) => {
            setEditingId(openTask.id);
            setDraft(nextDraft);
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
