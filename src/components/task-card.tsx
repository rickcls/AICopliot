"use client";

import { CalendarClock, GitBranch, Timer } from "lucide-react";
import { Badge } from "@/components/ui";
import { cn, formatDay } from "@/lib/utils";
import type { TaskRow } from "@/components/task-types";
import { isTaskOverdue } from "@/components/task-types";

/**
 * One card on the board.
 *
 * Deliberately shows content, not controls: the old card carried a full-width
 * status select plus three buttons, which is why the board read as a wall of
 * widgets. Actions live behind the menu button and the whole card is a drag
 * handle.
 */

const PRIORITY_STRIPE = {
  low: "bg-slate-300",
  medium: "bg-blue-400",
  high: "bg-amber-400",
  urgent: "bg-red-500",
} as const;

const PRIORITY_TONE = {
  low: "neutral",
  medium: "info",
  high: "warning",
  urgent: "danger",
} as const;

/** Initials for the assignee chip; falls back to the email local part. */
function initials(name: string | null, email: string): string {
  const source = name?.trim() || email.split("@")[0];
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0] ?? "");
  return letters.join("").toUpperCase() || "?";
}

export function TaskCard({
  task,
  dragging,
  busy,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  task: TaskRow;
  dragging: boolean;
  busy: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const overdue = isTaskOverdue(task);

  return (
    <article
      draggable={!busy}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        // Firefox will not start a drag without data on the transfer.
        event.dataTransfer.setData("text/plain", task.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative cursor-grab overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition-all",
        "hover:border-slate-300 hover:shadow-md active:cursor-grabbing",
        dragging && "opacity-40",
        busy && "pointer-events-none opacity-60",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 w-1",
          PRIORITY_STRIPE[task.priority],
        )}
      />

      <div className="py-2.5 pr-2.5 pl-3.5">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 flex-1 text-left text-sm leading-snug font-medium text-pretty text-slate-900 hover:underline"
          >
            {task.title}
          </button>
          {task.assignee ? (
            <span
              title={task.assignee.name ?? task.assignee.email}
              className="grid size-6 shrink-0 place-items-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-700"
            >
              {initials(task.assignee.name, task.assignee.email)}
            </span>
          ) : null}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge tone={PRIORITY_TONE[task.priority]}>{task.priority}</Badge>

          {task.dueDate ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium",
                overdue
                  ? "bg-red-50 text-red-700"
                  : "bg-slate-100 text-slate-600",
              )}
              title={overdue ? "Past its due date" : "Due date"}
            >
              <CalendarClock className="size-3" aria-hidden />
              {formatDay(task.dueDate)}
            </span>
          ) : null}

          {task.estimatedHours !== null ? (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600"
              title="Estimate"
            >
              <Timer className="size-3" aria-hidden />
              {task.estimatedHours}h
            </span>
          ) : null}

          {task.dependencies.length > 0 ? (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600"
              title={`Depends on ${task.dependencies.length} task(s)`}
            >
              <GitBranch className="size-3" aria-hidden />
              {task.dependencies.length}
            </span>
          ) : null}

          {task.source === "ai_suggested" ? (
            <Badge tone="info">AI suggested</Badge>
          ) : null}
          {task.citations.length > 0 ? (
            <Badge tone="neutral">
              {task.citations.length} source
              {task.citations.length === 1 ? "" : "s"}
            </Badge>
          ) : null}
        </div>
      </div>
    </article>
  );
}
