"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleAlert, Flag } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { PRIORITY_FLAG } from "@/components/task-types";
import { CheckInStrip } from "@/components/today/check-in-strip";
import { useToast } from "@/components/toast";
import { Badge, Button, FOCUS_RING, Input, buttonClasses } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface TodayRowTask {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  priority: "low" | "medium" | "high" | "urgent";
  /** Already formatted on the server, so the row cannot disagree with it. */
  dueLabel: string | null;
  overdue: boolean;
  blockedLabel: string | null;
  staleDays: number | null;
}

/**
 * One line per task on Today, with the check-in one click away: Update opens
 * a strip with an optional note and four answers. Every answer goes through
 * the check-in route, which uses the board's own write path, and the page then
 * re-renders from the server so buckets and counts stay one source of truth.
 */
export function TodayTaskRow({ task }: { task: TodayRowTask }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [due, setDue] = useState<string | null>(null);
  const [savingDue, setSavingDue] = useState(false);
  const priority = t(`priority.${task.priority}`);

  // Saved on submit, not on change: a date field reports a value as soon as
  // each part is filled, so typing a year would save 0002-10-21 first.
  async function saveDue(value: string) {
    setSavingDue(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueDate: value }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(t("today.dueSetFailed"), data.error);
        return;
      }
      toast.success(t("today.dueSet"));
      setDue(null);
      // The task moves to the bucket its new date belongs in.
      router.refresh();
    } catch {
      toast.error(t("common.couldNotReach"));
    } finally {
      setSavingDue(false);
    }
  }

  return (
    <li>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3 transition-colors hover:bg-sand-50/70 sm:flex-nowrap">
        <span title={t("priority.flag", { level: priority })} className="shrink-0">
          <span className="sr-only">{t("priority.flag", { level: priority })}</span>
          <Flag aria-hidden fill="currentColor" className={cn("size-3.5", PRIORITY_FLAG[task.priority])} />
        </span>
        <Link
          href={`/projects/${task.projectId}/tasks?task=${task.id}`}
          className={cn(
            // A phone shows the whole title over two lines rather than three
            // words and an ellipsis; from `sm` up the row has room to truncate.
            "min-w-0 flex-1 rounded text-[15px] font-medium break-words text-sand-900 underline-offset-2 hover:underline sm:truncate",
            FOCUS_RING,
          )}
        >
          {task.title}
        </Link>
        {task.staleDays !== null ? (
          <Badge tone="warning">{t("today.staleBadge", { count: task.staleDays })}</Badge>
        ) : null}
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-sand-500 sm:shrink-0 sm:flex-nowrap">
          {task.blockedLabel ? (
            <span className="font-medium text-red-700">{task.blockedLabel}</span>
          ) : null}
          <span className="max-w-40 truncate">{task.projectName}</span>
          {task.dueLabel ? (
            // Overdue carries a glyph as well as red: the brand terracotta sits
            // close enough to red that colour alone would not say "late".
            <span
              className={cn(
                "inline-flex items-center gap-1 tabular-nums",
                task.overdue ? "font-medium text-red-700" : undefined,
              )}
            >
              {task.overdue ? <CircleAlert aria-hidden className="size-3.5" /> : null}
              {task.dueLabel}
            </span>
          ) : due === null ? (
            <button
              type="button"
              onClick={() => setDue("")}
              className={cn(
                "rounded-full bg-amber-50 px-2.5 py-0.5 font-medium text-amber-800 ring-1 ring-amber-200/70 ring-inset transition-colors hover:bg-amber-100",
                FOCUS_RING,
              )}
            >
              {t("today.noDueDate")}
            </button>
          ) : (
            <form
              className="flex items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                if (due) void saveDue(due);
              }}
            >
              <Input
                type="date"
                value={due}
                disabled={savingDue}
                aria-label={t("today.setDueLabel", { title: task.title })}
                onChange={(event) => setDue(event.target.value)}
                className="h-7 w-auto px-2 text-xs"
              />
              <Button type="submit" size="sm" disabled={savingDue || !due}>
                {t("today.setDue")}
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={savingDue} onClick={() => setDue(null)}>
                {t("common.cancel")}
              </Button>
            </form>
          )}
        </span>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={`${ids}-actions`}
          aria-label={t("checkIn.actions", { title: task.title })}
          className={buttonClasses({
            variant: open ? "ghost" : "secondary",
            size: "sm",
            className: "h-7 shrink-0 px-2.5 text-xs",
          })}
        >
          {open ? t("checkIn.close") : t("checkIn.open")}
        </button>
      </div>

      {open ? (
        <CheckInStrip
          id={`${ids}-actions`}
          taskId={task.id}
          allowSnooze={task.staleDays !== null}
          onSaved={() => setOpen(false)}
        />
      ) : null}
    </li>
  );
}
