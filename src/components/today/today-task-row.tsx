"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleAlert } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { PriorityBadge } from "@/components/priority-badge";
import { CheckInActions } from "@/components/today/check-in-actions";
import { CheckInStrip } from "@/components/today/check-in-strip";
import { useToast } from "@/components/toast";
import { DatePicker } from "@/components/date-picker";
import { Badge, FOCUS_RING } from "@/components/ui";
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
  const [savingDue, setSavingDue] = useState(false);

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
        <PriorityBadge priority={task.priority} />
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
          ) : (
            // The chip is the calendar's trigger: pick a day and it is saved,
            // so there is no form to fill and submit.
            <DatePicker
              value=""
              clearable={false}
              disabled={savingDue}
              aria-label={t("today.setDueLabel", { title: task.title })}
              onValueChange={(date) => void saveDue(date)}
              className={cn(
                "rounded-full bg-amber-50 px-2.5 py-0.5 font-medium text-amber-800 ring-1 ring-amber-200/70 ring-inset transition-colors hover:bg-amber-100",
              )}
            >
              {t("today.noDueDate")}
            </DatePicker>
          )}
        </span>
        <CheckInActions
          taskId={task.id}
          title={task.title}
          open={open}
          onToggle={() => setOpen(!open)}
          controls={`${ids}-actions`}
        />
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
