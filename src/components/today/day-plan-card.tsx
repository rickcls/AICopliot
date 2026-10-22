"use client";

import { Fragment, useId, useState } from "react";
import Link from "next/link";
import { CalendarClock, Check, CircleCheck, RefreshCw } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { CheckInStrip, type CheckInAction } from "@/components/today/check-in-strip";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  FOCUS_RING,
  Input,
  SectionHeader,
  Spinner,
  buttonClasses,
} from "@/components/ui";
import type { PlanItemState } from "@/lib/today/plan";
import type { DayPlanView } from "@/lib/today/plan-service";
import { cn } from "@/lib/utils";

type Mode = "replace" | "next";

/** Half-hour steps between 0.5 and 14, the range the planner accepts. */
function hoursFrom(minutes: number): number {
  return Math.min(14, Math.max(0.5, Math.round(minutes / 30) / 2));
}

/**
 * The day's suggested order. It is a suggestion and nothing more — no task is
 * changed by making or remaking it — so it is shown as a numbered list with
 * the reason for each step.
 *
 * Each item can be checked in from here, the same way as a Today row, and its
 * mark comes from the task as it is now: ✓ once done, "updated" once anything
 * was said about it since it was planned. When nothing in the plan is still
 * waiting on the person, the card offers the next batch — the tasks not yet in
 * today's plan, for the hours they give — instead of leaving a finished list.
 */
export function DayPlanCard({ initialPlan }: { initialPlan: DayPlanView | null }) {
  const t = useT();
  const ids = useId();
  const [plan, setPlan] = useState(initialPlan);
  const [mode, setMode] = useState<Mode>("replace");
  const [editing, setEditing] = useState(initialPlan === null);
  const [hours, setHours] = useState(initialPlan ? hoursFrom(initialPlan.availableMinutes) : 6);
  const [note, setNote] = useState(initialPlan?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingIn, setCheckingIn] = useState<string | null>(null);

  async function make() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/today/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          availableHours: hours,
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(mode === "next" ? { append: true } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.plan) {
        setError(data.code === "nothing_left" ? t("plan.nothingLeft") : (data.error ?? t("plan.failed")));
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

  function open(next: Mode) {
    setMode(next);
    setError(null);
    if (next === "next" && plan) {
      // Whatever is left of the day, or two hours when the plan filled it.
      const left = plan.availableMinutes - used;
      setHours(left >= 30 ? hoursFrom(left) : 2);
      setNote("");
    }
    setEditing(true);
  }

  /** The mark moves at once; the page's refresh then brings the task's real state. */
  function checkedIn(taskId: string, action: CheckInAction) {
    setCheckingIn(null);
    const state: PlanItemState = action === "done" ? "done" : "updated";
    setPlan((current) =>
      current
        ? { ...current, items: current.items.map((item) => (item.taskId === taskId ? { ...item, state } : item)) }
        : current,
    );
  }

  const used = plan ? plan.items.reduce((sum, item) => sum + item.minutes, 0) : 0;
  const allHandled = plan !== null && plan.items.length > 0 && plan.items.every((item) => item.state !== "pending");

  return (
    <Card className="overflow-hidden">
      {/* The tinted band marks this card as the assistant's suggestion, set
          apart from the person's own work listed below it. */}
      <div className="border-b border-brand-100/80 bg-brand-50/60 px-5 py-4">
        <SectionHeader
          title={t("plan.title")}
          icon={<CalendarClock className="size-4.5 text-brand-600" />}
          description={
            plan && !editing
              ? t("plan.total", { used, available: plan.availableMinutes })
              : mode === "next"
                ? t("plan.nextLead")
                : t("plan.lead")
          }
        >
          {plan && !editing ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => open("replace")}>
              {t("plan.replan")}
            </Button>
          ) : null}
        </SectionHeader>
      </div>

      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void make();
          }}
          className="flex flex-wrap items-end gap-3 p-5"
        >
          {plan && mode === "replace" ? <p className="w-full text-xs text-sand-500">{t("plan.replaces")}</p> : null}
          <div>
            <label htmlFor={`${ids}-hours`} className="mb-1 block text-xs font-medium text-sand-500">
              {mode === "next" ? t("plan.nextHours") : t("plan.hours")}
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
            <label htmlFor={`${ids}-note`} className="mb-1 block text-xs font-medium text-sand-500">
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
          <div className="flex items-center gap-2">
            {plan ? (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
                {t("common.cancel")}
              </Button>
            ) : null}
            <Button type="submit" disabled={busy || !(hours >= 0.5 && hours <= 14)}>
              {busy ? <Spinner inverse /> : null}
              {busy ? t("plan.making") : mode === "next" ? t("plan.makeNext") : t("plan.make")}
            </Button>
          </div>
          {error ? (
            <div className="w-full">
              <ErrorState message={error} />
            </div>
          ) : null}
        </form>
      ) : null}

      {plan && !editing ? (
        <div className="p-5">
          {plan.summary || plan.note ? (
            <div className="mb-4 space-y-1">
              {plan.summary ? <p className="text-sm text-pretty text-sand-700">{plan.summary}</p> : null}
              {plan.note ? <p className="text-sm text-sand-500">{plan.note}</p> : null}
            </div>
          ) : null}
          <ol className="space-y-3">
            {plan.items.map((item, index) => {
              const firstOfBatch = item.batch > 1 && plan.items[index - 1]?.batch !== item.batch;
              const stripId = `${ids}-check-${item.taskId}`;
              return (
                <Fragment key={item.taskId}>
                  {firstOfBatch ? (
                    <li aria-hidden className="pt-2 text-xs font-medium text-sand-400">
                      {t("plan.batch", { count: item.batch })}
                    </li>
                  ) : null}
                  <li>
                    <div className="flex items-start gap-3">
                      <StateMark state={item.state} index={index} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <Link
                            href={`/projects/${item.projectId}/tasks?task=${item.taskId}`}
                            className={cn(
                              "rounded text-[15px] font-medium underline-offset-2 hover:underline",
                              FOCUS_RING,
                              item.state === "done" ? "text-sand-400 line-through" : "text-sand-900",
                            )}
                          >
                            {item.title}
                          </Link>
                          {item.state === "done" ? <span className="sr-only">{t("plan.done")}</span> : null}
                          {item.state === "updated" ? <Badge tone="info">{t("plan.updated")}</Badge> : null}
                          <span className="text-xs text-sand-500 tabular-nums">
                            {t("plan.minutes", { count: item.minutes })} · {item.projectName}
                          </span>
                        </div>
                        {item.reason ? <p className="text-xs text-sand-500">{item.reason}</p> : null}
                      </div>
                      {item.state !== "done" ? (
                        <button
                          type="button"
                          onClick={() => setCheckingIn(checkingIn === item.taskId ? null : item.taskId)}
                          aria-expanded={checkingIn === item.taskId}
                          aria-controls={stripId}
                          aria-label={t("checkIn.actions", { title: item.title })}
                          className={buttonClasses({
                            variant: checkingIn === item.taskId ? "ghost" : "secondary",
                            size: "sm",
                            className: "h-7 shrink-0 px-2.5 text-xs",
                          })}
                        >
                          {checkingIn === item.taskId ? t("checkIn.close") : t("checkIn.open")}
                        </button>
                      ) : null}
                    </div>
                    {checkingIn === item.taskId ? (
                      <CheckInStrip
                        id={stripId}
                        taskId={item.taskId}
                        allowSnooze={false}
                        onSaved={(action) => checkedIn(item.taskId, action)}
                        className="mt-2 ml-9 rounded-xl bg-sand-50 px-3 py-2.5"
                      />
                    ) : null}
                  </li>
                </Fragment>
              );
            })}
          </ol>

          {allHandled ? (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-sand-100 pt-4">
              <p className="flex items-center gap-2 text-sm text-sand-700">
                <CircleCheck aria-hidden className="size-4.5 shrink-0 text-emerald-600" />
                {t("plan.allHandled")}
              </p>
              <Button type="button" size="sm" onClick={() => open("next")}>
                {t("plan.nextBatch")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function StateMark({ state, index }: { state: PlanItemState; index: number }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold",
        state === "done"
          ? "bg-emerald-600 text-white"
          : state === "updated"
            ? "bg-blue-100 text-blue-700"
            : "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200/70",
      )}
    >
      {state === "done" ? (
        <Check className="size-3" />
      ) : state === "updated" ? (
        <RefreshCw className="size-3" />
      ) : (
        index + 1
      )}
    </span>
  );
}
