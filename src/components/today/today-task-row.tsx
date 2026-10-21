"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Flag } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { PRIORITY_FLAG } from "@/components/task-types";
import { CheckInStrip } from "@/components/today/check-in-strip";
import { useToast } from "@/components/toast";
import { Badge, Button, FOCUS_RING, Input } from "@/components/ui";
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 sm:flex-nowrap">
        <span title={t("priority.flag", { level: priority })} className="shrink-0">
          <span className="sr-only">{t("priority.flag", { level: priority })}</span>
          <Flag aria-hidden fill="currentColor" className={cn("size-3.5", PRIORITY_FLAG[task.priority])} />
        </span>
        <Link
          href={`/projects/${task.projectId}/tasks?task=${task.id}`}
          className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 hover:underline"
        >
          {task.title}
        </Link>
        {task.staleDays !== null ? (
          <Badge tone="warning">{t("today.staleBadge", { count: task.staleDays })}</Badge>
        ) : null}
        <span className="flex shrink-0 items-center gap-3 text-xs text-slate-500">
          {task.blockedLabel ? (
            <span className="font-medium text-red-700">{task.blockedLabel}</span>
          ) : null}
          <span className="max-w-40 truncate">{task.projectName}</span>
          {task.dueLabel ? (
            <span className={cn("tabular-nums", task.overdue ? "font-medium text-red-700" : undefined)}>
              {task.dueLabel}
            </span>
          ) : due === null ? (
            <button
              type="button"
              onClick={() => setDue("")}
              className={cn(
                "rounded-md bg-amber-50 px-2 py-0.5 font-medium text-amber-800 ring-1 ring-amber-200 ring-inset hover:bg-amber-100",
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
          className={cn(
            "shrink-0 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900",
            FOCUS_RING,
          )}
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
