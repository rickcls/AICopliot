"use client";

import { useEffect, useRef, useState } from "react";
import {
  CalendarClock,
  Flag,
  GitBranch,
  GripVertical,
  PanelRight,
  Timer,
} from "lucide-react";
import { Avatar, FOCUS_RING, Input, Select } from "@/components/ui";
import { toPartialPayload, type TaskDraft } from "@/components/task-form";
import {
  PRIORITY_FLAG,
  STATUS_DOT,
  TASK_PRIORITIES,
  isTaskOverdue,
  statusColorToken,
  toDateInput,
  type MemberOption,
  type TaskPriority,
  type TaskRow,
} from "@/components/task-types";
import { cn, formatDay } from "@/lib/utils";

const PRIORITY_TEXT = {
  low: "text-slate-400",
  medium: "text-slate-600",
  high: "text-amber-700",
  urgent: "font-semibold text-red-700",
} as const;

export type ListEditField =
  | "title"
  | "assigneeId"
  | "priority"
  | "dueDate"
  | "estimatedHours";

/**
 * One list row. Double-click a value cell to edit it in place (auto-saves).
 * Opening the detail panel is a separate control — never bound to the same
 * click target as edit, because a delayed single-click open always races a
 * double-click and steals it.
 */
export function TaskListRow({
  task,
  members,
  selected,
  selectedCount,
  dragging,
  busy,
  onToggleSelect,
  onOpen,
  onTaskChange,
  onError,
  onDragStart,
  onDragEnd,
}: {
  task: TaskRow;
  members: MemberOption[];
  selected: boolean;
  selectedCount: number;
  dragging: boolean;
  busy: boolean;
  onToggleSelect: (shiftKey: boolean) => void;
  onOpen: () => void;
  onTaskChange: (task: TaskRow) => void;
  onError: (message: string) => void;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const [editing, setEditing] = useState<ListEditField | null>(null);
  const [saving, setSaving] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [estimateDraft, setEstimateDraft] = useState(
    task.estimatedHours === null ? "" : String(task.estimatedHours),
  );
  const titleRef = useRef<HTMLInputElement>(null);
  const estimateRef = useRef<HTMLInputElement>(null);
  const assigneeRef = useRef<HTMLSelectElement>(null);
  const priorityRef = useRef<HTMLSelectElement>(null);
  const dueRef = useRef<HTMLInputElement>(null);

  const overdue = isTaskOverdue(task);
  const rowTone = statusColorToken(task.status);
  const disabled = busy || saving;

  useEffect(() => {
    if (editing === "title") titleRef.current?.focus();
    if (editing === "estimatedHours") estimateRef.current?.focus();
    if (editing === "assigneeId") assigneeRef.current?.focus();
    if (editing === "priority") priorityRef.current?.focus();
    if (editing === "dueDate") {
      dueRef.current?.focus();
      dueRef.current?.showPicker?.();
    }
  }, [editing]);

  function beginEdit(field: ListEditField) {
    if (disabled) return;
    if (field === "title") setTitleDraft(task.title);
    if (field === "estimatedHours") {
      setEstimateDraft(
        task.estimatedHours === null ? "" : String(task.estimatedHours),
      );
    }
    setEditing(field);
  }

  async function save(patch: Partial<TaskDraft>) {
    setSaving(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPartialPayload(patch)),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        onError(data.error ?? "Could not save that change.");
        return false;
      }
      onTaskChange(data.task);
      return true;
    } catch {
      onError("Could not reach the server.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function commitTitle() {
    const next = titleDraft.trim();
    setEditing(null);
    if (next === "" || next === task.title) {
      setTitleDraft(task.title);
      return;
    }
    await save({ title: next });
  }

  async function commitEstimate() {
    const current =
      task.estimatedHours === null ? "" : String(task.estimatedHours);
    setEditing(null);
    if (estimateDraft === current) return;
    await save({ estimatedHours: estimateDraft });
  }

  async function commitDue(value: string) {
    const current = toDateInput(task.dueDate);
    setEditing(null);
    if (value === current) return;
    await save({ dueDate: value });
  }

  async function commitAssignee(value: string) {
    setEditing(null);
    if (value === (task.assigneeId ?? "")) return;
    await save({ assigneeId: value });
  }

  async function commitPriority(value: TaskPriority) {
    setEditing(null);
    if (value === task.priority) return;
    await save({ priority: value });
  }

  function onEditKeyDown(
    event: React.KeyboardEvent,
    commit: () => void,
  ) {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setEditing(null);
      setTitleDraft(task.title);
      setEstimateDraft(
        task.estimatedHours === null ? "" : String(task.estimatedHours),
      );
    }
  }

  return (
    <tr
      aria-selected={selected}
      className={cn(
        "group transition-colors hover:bg-slate-50",
        disabled && "pointer-events-none opacity-60",
        dragging && "opacity-40",
        selected && "bg-slate-100 hover:bg-slate-100",
      )}
    >
      <td className="px-2 py-2.5">
        <input
          type="checkbox"
          checked={selected}
          aria-label={`Select ${task.title}`}
          onChange={(event) =>
            onToggleSelect((event.nativeEvent as MouseEvent).shiftKey)
          }
          className="size-3.5 rounded border-slate-300 text-slate-900 focus-visible:ring-slate-900"
        />
      </td>
      <td className="px-1 py-2.5">
        <button
          type="button"
          draggable={!disabled}
          aria-label={
            selected && selectedCount > 1
              ? `Drag ${selectedCount} selected tasks to another status`
              : `Drag ${task.title} to another status`
          }
          title={
            selected && selectedCount > 1
              ? `Drag ${selectedCount} selected`
              : "Drag to another status"
          }
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          className={cn(
            "inline-flex size-7 cursor-grab items-center justify-center rounded-md text-slate-300 transition-colors hover:bg-slate-200/80 hover:text-slate-500 active:cursor-grabbing",
            FOCUS_RING,
          )}
        >
          <GripVertical className="size-3.5" aria-hidden />
        </button>
      </td>
      <th
        scope="row"
        className="px-2 py-2.5 text-left font-normal"
        title="Double-click to edit"
        onDoubleClick={() => beginEdit("title")}
      >
        <span className="flex items-center gap-2.5">
          <span
            aria-hidden
            className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[rowTone])}
          />
          <span className="min-w-0 flex-1">
            {editing === "title" ? (
              <Input
                ref={titleRef}
                value={titleDraft}
                maxLength={200}
                aria-label="Task name"
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => void commitTitle()}
                onKeyDown={(event) =>
                  onEditKeyDown(event, () => void commitTitle())
                }
                className="h-8 text-sm font-medium"
              />
            ) : (
              <>
                <span className="block truncate font-medium text-slate-900">
                  {task.title}
                </span>
                {task.description ? (
                  <span className="mt-0.5 block truncate text-xs text-slate-500">
                    {task.description}
                  </span>
                ) : null}
              </>
            )}
          </span>
          {editing !== "title" ? (
            <button
              type="button"
              onClick={onOpen}
              aria-label={`Open ${task.title} details`}
              title="Open details"
              className={cn(
                "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-200/80 hover:text-slate-700",
                FOCUS_RING,
              )}
            >
              <PanelRight className="size-3.5" aria-hidden />
            </button>
          ) : null}
          {task.dependencies.length > 0 && editing !== "title" ? (
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
      <td
        className="cursor-default px-3 py-2.5"
        title="Double-click to edit"
        onDoubleClick={() => beginEdit("assigneeId")}
      >
        {editing === "assigneeId" ? (
          <Select
            ref={assigneeRef}
            aria-label="Assignee"
            className="h-8 w-full max-w-full text-xs"
            defaultValue={task.assigneeId ?? ""}
            onChange={(event) => void commitAssignee(event.target.value)}
            onBlur={() => setEditing(null)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setEditing(null);
            }}
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Select>
        ) : task.assignee ? (
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
          <span className="text-xs text-slate-400">Unassigned</span>
        )}
      </td>
      <td
        className="cursor-default px-3 py-2.5"
        title="Double-click to edit"
        onDoubleClick={() => beginEdit("priority")}
      >
        {editing === "priority" ? (
          <Select
            ref={priorityRef}
            aria-label="Priority"
            className="h-8 w-full max-w-full capitalize text-xs"
            defaultValue={task.priority}
            onChange={(event) =>
              void commitPriority(event.target.value as TaskPriority)
            }
            onBlur={() => setEditing(null)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setEditing(null);
            }}
          >
            {TASK_PRIORITIES.map((priority) => (
              <option key={priority} value={priority} className="capitalize">
                {priority}
              </option>
            ))}
          </Select>
        ) : (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-xs capitalize",
              PRIORITY_TEXT[task.priority],
            )}
          >
            <Flag
              aria-hidden
              fill="currentColor"
              className={cn("size-3.5 shrink-0", PRIORITY_FLAG[task.priority])}
            />
            {task.priority}
          </span>
        )}
      </td>
      <td
        className={cn(
          "cursor-default px-3 py-2.5 text-xs whitespace-nowrap",
          overdue ? "font-medium text-red-700" : "text-slate-600",
        )}
        title="Double-click to edit"
        onDoubleClick={() => beginEdit("dueDate")}
      >
        {editing === "dueDate" ? (
          <Input
            ref={dueRef}
            type="date"
            aria-label="Due date"
            defaultValue={toDateInput(task.dueDate)}
            onChange={(event) => void commitDue(event.target.value)}
            onBlur={(event) => {
              if (editing === "dueDate") void commitDue(event.target.value);
            }}
            onKeyDown={(event) =>
              onEditKeyDown(event, () => {
                if (dueRef.current) void commitDue(dueRef.current.value);
              })
            }
            className="h-8 w-auto max-w-none text-xs"
          />
        ) : task.dueDate ? (
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="size-3.5 shrink-0" aria-hidden />
            {formatDay(task.dueDate)}
            {overdue ? " · overdue" : ""}
          </span>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      <td
        className="cursor-default px-4 py-2.5 text-right text-xs whitespace-nowrap text-slate-600 tabular-nums"
        title="Double-click to edit"
        onDoubleClick={() => beginEdit("estimatedHours")}
      >
        {editing === "estimatedHours" ? (
          <Input
            ref={estimateRef}
            type="number"
            min={0}
            step="0.5"
            aria-label="Estimate hours"
            value={estimateDraft}
            onChange={(event) => setEstimateDraft(event.target.value)}
            onBlur={() => void commitEstimate()}
            onKeyDown={(event) =>
              onEditKeyDown(event, () => void commitEstimate())
            }
            className="ml-auto h-8 w-20 max-w-none text-xs"
          />
        ) : task.estimatedHours === null ? (
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
}
