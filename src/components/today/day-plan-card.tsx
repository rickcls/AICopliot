"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { CalendarClock, Check } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button, Card, ErrorState, Input, Spinner } from "@/components/ui";
import type { DayPlanView } from "@/lib/today/plan-service";
import { cn } from "@/lib/utils";

/**
 * The day's suggested order. It is a suggestion and nothing more — no task is
 * changed by making or remaking it — so it is shown as a numbered list with
 * the reason for each step, and finished tasks are ticked from their live
 * status rather than from anything the plan remembers.
 */
export function DayPlanCard({ initialPlan }: { initialPlan: DayPlanView | null }) {
  const t = useT();
  const ids = useId();
  const [plan, setPlan] = useState(initialPlan);
  const [editing, setEditing] = useState(initialPlan === null);
  const [hours, setHours] = useState(initialPlan ? initialPlan.availableMinutes / 60 : 6);
  const [note, setNote] = useState(initialPlan?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function make() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/today/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ availableHours: hours, ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.plan) {
        setError(data.error ?? t("plan.failed"));
        return;
      }
      setPlan(data.plan as DayPlanView);
      setEditing(false);
    } catch {
      setError(t("common.couldNotReach"));
    } finally {
      setBusy(false);
    }
  }

  const used = plan ? plan.items.reduce((sum, item) => sum + item.minutes, 0) : 0;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <CalendarClock className="size-4 text-slate-400" aria-hidden />
            {t("plan.title")}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {plan && !editing
              ? t("plan.total", { used, available: plan.availableMinutes })
              : t("plan.lead")}
          </p>
        </div>
        {plan && !editing ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
            {t("plan.replan")}
          </Button>
        ) : null}
      </div>

      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void make();
          }}
          className="flex flex-wrap items-end gap-3 p-4"
        >
          {plan ? <p className="w-full text-xs text-slate-500">{t("plan.replaces")}</p> : null}
          <div>
            <label htmlFor={`${ids}-hours`} className="mb-1 block text-xs font-medium text-slate-500">
              {t("plan.hours")}
            </label>
            <Input
              id={`${ids}-hours`}
              type="number"
              min={0.5}
              max={14}
              step={0.5}
              value={hours}
              onChange={(event) => setHours(Number(event.target.value))}
              className="h-9 w-24"
            />
          </div>
          <div className="min-w-0 flex-1 basis-64">
            <label htmlFor={`${ids}-note`} className="mb-1 block text-xs font-medium text-slate-500">
              {t("plan.note")}
            </label>
            <Input
              id={`${ids}-note`}
              value={note}
              maxLength={500}
              placeholder={t("plan.notePlaceholder")}
              onChange={(event) => setNote(event.target.value)}
              className="h-9"
            />
          </div>
          <Button type="submit" disabled={busy || !(hours >= 0.5 && hours <= 14)}>
            {busy ? <Spinner className="border-white/40 border-t-white" /> : null}
            {busy ? t("plan.making") : t("plan.make")}
          </Button>
          {error ? (
            <div className="w-full">
              <ErrorState message={error} />
            </div>
          ) : null}
        </form>
      ) : null}

      {plan && !editing ? (
        <div className="p-4">
          {plan.summary || plan.note ? (
            <div className="mb-3 space-y-1">
              {plan.summary ? <p className="text-sm text-pretty text-slate-700">{plan.summary}</p> : null}
              {plan.note ? <p className="text-sm text-slate-500">{plan.note}</p> : null}
            </div>
          ) : null}
          <ol className="space-y-2">
            {plan.items.map((item, index) => (
              <li key={item.taskId} className="flex items-start gap-3">
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold",
                    item.done ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600",
                  )}
                >
                  {item.done ? <Check className="size-3" /> : index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <Link
                      href={`/projects/${item.projectId}/tasks?task=${item.taskId}`}
                      className={cn(
                        "text-sm font-medium hover:underline",
                        item.done ? "text-slate-400 line-through" : "text-slate-900",
                      )}
                    >
                      {item.title}
                    </Link>
                    {item.done ? <span className="sr-only">{t("plan.done")}</span> : null}
                    <span className="text-xs text-slate-500 tabular-nums">
                      {t("plan.minutes", { count: item.minutes })} · {item.projectName}
                    </span>
                  </div>
                  {item.reason ? <p className="text-xs text-slate-500">{item.reason}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </Card>
  );
}
