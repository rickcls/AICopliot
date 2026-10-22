"use client";

import { CalendarClock, Flag, GitBranch, Sparkles, Timer } from "lucide-react";
import { useDateLocale, useT } from "@/components/i18n-provider";
import { Avatar, Badge, FOCUS_RING, type BadgeTone } from "@/components/ui";
import { cn, formatDay } from "@/lib/utils";
import type { TaskRow } from "@/components/task-types";
import { PRIORITY_FLAG, isTaskOverdue } from "@/components/task-types";

/**
 * One card on the board.
 *
 * Deliberately shows content, not controls: the old card carried a full-width
 * status select plus three buttons, which is why the board read as a wall of
 * widgets. Actions live behind the menu button and the whole card is a drag
 * handle.
 *
 * Every fact below the title is one icon-and-number badge on a single wrapping
 * row. They used to be full text badges — "medium", "AI suggested", "3 sources"
 * — and at a board column's ~200px each one claimed its own line, so a card with
 * nothing but a priority and a citation count stood 200px tall.
 *
 * Priority is drawn once, as the flag. It used to be a stripe down the left
 * edge as well, in the same colour — two marks saying one thing.
 */

/** The `Badge` shape, kept compact so the facts read as one row. */
function Fact({
  title,
  tone = "neutral",
  children,
}: {
  title: string;
  tone?: BadgeTone;
  children: React.ReactNode;
}) {
  return (
    <Badge title={title} tone={tone} className="gap-1 px-1.5 tabular-nums">
      {children}
    </Badge>
  );
}

export function TaskCard({
  task,
  todayIso,
  dragging,
  busy,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  task: TaskRow;
  todayIso: string;
  dragging: boolean;
  busy: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const overdue = isTaskOverdue(task, todayIso);
  const t = useT();
  const dateLocale = useDateLocale();
  const priorityFlag = t("priority.flag", { level: t(`priority.${task.priority}`) });

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
        "group relative cursor-grab rounded-xl border border-sand-200/80 bg-white shadow-xs transition-[border-color,box-shadow,opacity]",
        "hover:border-sand-300 hover:shadow-soft active:cursor-grabbing",
        dragging && "opacity-40",
        busy && "pointer-events-none opacity-60",
      )}
    >
      <div className="p-3">
        <div className="flex items-start gap-2">
          {/* The flag replaced a text badge, so the label it dropped is kept
              for screen readers — colour is the only cue that remains visually. */}
          <span title={priorityFlag} className="mt-0.5 shrink-0">
            <span className="sr-only">{priorityFlag}</span>
            <Flag
              aria-hidden
              fill="currentColor"
              className={cn("size-3.5", PRIORITY_FLAG[task.priority])}
            />
          </span>
          <button
            type="button"
            onClick={onOpen}
            className={cn(
              "min-w-0 flex-1 rounded text-left text-sm leading-snug font-medium text-pretty text-sand-900 underline-offset-2 hover:underline",
              FOCUS_RING,
            )}
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

        <div className="mt-2 flex flex-wrap items-center gap-1 pl-5.5">
          {task.dueDate ? (
            <Fact
              title={overdue ? t("tasks.card.pastDue") : t("tasks.card.dueDate")}
              tone={overdue ? "danger" : "neutral"}
            >
              <CalendarClock className="size-3" aria-hidden />
              {formatDay(task.dueDate, dateLocale)}
            </Fact>
          ) : null}

          {task.estimatedHours !== null ? (
            <Fact title={t("tasks.card.estimate")}>
              <Timer className="size-3" aria-hidden />
              {t("common.hours", { hours: task.estimatedHours })}
            </Fact>
          ) : null}

          {task.dependencies.length > 0 ? (
            <Fact title={t("tasks.card.dependsOn", { count: task.dependencies.length })}>
              <GitBranch className="size-3" aria-hidden />
              {task.dependencies.length}
            </Fact>
          ) : null}

          {/* One chip, not two: "AI suggested" and "3 sources" always appeared
              together, and a generated task with no citations cannot exist. */}
          {task.source === "ai_suggested" ? (
            <Fact
              tone="info"
              title={t("tasks.card.aiSources", { count: task.citations.length })}
            >
              <Sparkles className="size-3" aria-hidden />
              {task.citations.length > 0 ? task.citations.length : "AI"}
            </Fact>
          ) : null}
        </div>
      </div>
    </article>
  );
}
