"use client";

import { CalendarClock, Flag, GitBranch, Sparkles, Timer } from "lucide-react";
import { Avatar } from "@/components/ui";
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
 *
 * Every fact below the title is one icon-and-number chip on a single wrapping
 * row. They used to be full text badges — "medium", "AI suggested", "3 sources"
 * — and at a board column's ~200px each one claimed its own line, so a card with
 * nothing but a priority and a citation count stood 200px tall. Priority in
 * particular is already the stripe down the left edge, so spelling it out again
 * cost a line to repeat what colour had said.
 */

const PRIORITY_STRIPE = {
  low: "bg-slate-300",
  medium: "bg-blue-400",
  high: "bg-amber-400",
  urgent: "bg-red-500",
} as const;

const PRIORITY_FLAG = {
  low: "text-slate-400",
  medium: "text-blue-500",
  high: "text-amber-500",
  urgent: "text-red-500",
} as const;

/** One chip shape for every fact, so the row reads as a row and not a pile. */
function Chip({
  title,
  tone = "neutral",
  children,
}: {
  title: string;
  tone?: "neutral" | "danger" | "info";
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
        tone === "neutral" && "bg-slate-100 text-slate-600",
        tone === "danger" && "bg-red-50 text-red-700",
        tone === "info" && "bg-blue-50 text-blue-700",
      )}
    >
      {children}
    </span>
  );
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

      <div className="py-2 pr-2 pl-3">
        <div className="flex items-start gap-2">
          {/* The flag replaced a text badge, so the label it dropped is kept
              for screen readers — colour is the only cue that remains visually. */}
          <span title={`${task.priority} priority`} className="mt-0.5 shrink-0">
            <span className="sr-only">{task.priority} priority</span>
            <Flag
              aria-hidden
              fill="currentColor"
              className={cn("size-3.5", PRIORITY_FLAG[task.priority])}
            />
          </span>
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 flex-1 text-left text-sm leading-snug font-medium text-pretty text-slate-900 hover:underline"
          >
            {task.title}
          </button>
          {task.assignee ? (
            <Avatar
              name={task.assignee.name}
              email={task.assignee.email}
              className="size-5.5"
            />
          ) : null}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-5.5">
          {task.dueDate ? (
            <Chip
              title={overdue ? "Past its due date" : "Due date"}
              tone={overdue ? "danger" : "neutral"}
            >
              <CalendarClock className="size-3" aria-hidden />
              {formatDay(task.dueDate)}
            </Chip>
          ) : null}

          {task.estimatedHours !== null ? (
            <Chip title="Estimate">
              <Timer className="size-3" aria-hidden />
              {task.estimatedHours}h
            </Chip>
          ) : null}

          {task.dependencies.length > 0 ? (
            <Chip title={`Depends on ${task.dependencies.length} task(s)`}>
              <GitBranch className="size-3" aria-hidden />
              {task.dependencies.length}
            </Chip>
          ) : null}

          {/* One chip, not two: "AI suggested" and "3 sources" always appeared
              together, and a generated task with no citations cannot exist. */}
          {task.source === "ai_suggested" ? (
            <Chip
              tone="info"
              title={`AI suggested · ${task.citations.length} source${
                task.citations.length === 1 ? "" : "s"
              }`}
            >
              <Sparkles className="size-3" aria-hidden />
              {task.citations.length > 0 ? task.citations.length : "AI"}
            </Chip>
          ) : null}
        </div>
      </div>
    </article>
  );
}
