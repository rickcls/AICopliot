"use client";

import { CalendarDays, ChevronDown } from "lucide-react";
import { useDateLocale, useT } from "@/components/i18n-provider";
import { daysFromToday } from "@/components/task-types";
import { FOCUS_RING } from "@/components/ui";
import { cn, formatDay } from "@/lib/utils";

/**
 * A task's fields drawn as pills — a status in its column's colour, a person
 * with their avatar, a date with "3 days left" — rather than quiet text.
 *
 * The task panel used chrome-less selects (`QUIET_CONTROL`) so that seven
 * fields would not read as seven boxes. In practice every value then read as
 * plain text, and nothing said it could be changed. A pill gives each value a
 * shape and a colour without bringing the form-box look back.
 *
 * Every pill is still the native control underneath — a `<select>`, a date
 * input, a number input — so the keyboard, the platform picker, and a screen
 * reader behave exactly as before. Only the paint changed.
 */

const PILL = "relative inline-flex h-8 max-w-full min-w-0 items-center rounded-full text-sm font-medium transition-colors";

/** The resting look of a value that has no special colour. */
export const PILL_NEUTRAL = "bg-sand-100 text-sand-800 ring-1 ring-inset ring-sand-200/80 hover:bg-sand-200/70";

/**
 * An empty value: a dashed outline that says "something goes here". A ring
 * cannot be dashed, so this is a border, and `ring-0` cancels the ring a
 * tinted pill would otherwise draw around it.
 */
export const PILL_EMPTY = "border border-dashed border-sand-300 text-sand-500 ring-0 hover:border-sand-400 hover:text-sand-700";

/**
 * A `<select>` painted as a pill. The tone goes on the wrapper so the icon and
 * chevron share its colour; the select itself is transparent on top.
 */
export function PillSelect({
  icon,
  tone = PILL_NEUTRAL,
  className,
  children,
  ...props
}: React.ComponentProps<"select"> & {
  /** Leading glyph or avatar; decorative. */
  icon?: React.ReactNode;
  tone?: string;
}) {
  return (
    <span className={cn(PILL, "ring-1 ring-inset", tone, className)}>
      {icon ? (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-2 flex items-center">
          {icon}
        </span>
      ) : null}
      <select
        className={cn(
          "h-full max-w-full min-w-0 cursor-pointer appearance-none truncate rounded-full bg-transparent pr-8 text-inherit",
          icon ? "pl-8" : "pl-3",
          FOCUS_RING,
          "disabled:cursor-not-allowed disabled:opacity-60",
          // Windows paints the option list in the select's own colours, so a
          // solid red pill would otherwise open a red menu with white text.
          "[&>option]:bg-white [&>option]:text-sand-900",
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 opacity-60"
      />
    </span>
  );
}

/**
 * A date as a pill: "30 Oct 2026 · 8 days left", or a dashed "Set date".
 *
 * The native date input sits on top, invisible until it has focus, and a click
 * opens the platform picker directly (`showPicker`). Shown at rest it printed
 * the platform's own "dd/mm/yyyy" — the plain-text look this replaces — while
 * a keyboard user tabbing in still gets the input's own fields to type in.
 */
export function PillDate({
  value,
  display,
  hint,
  tone,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type" | "value"> & {
  /** `YYYY-MM-DD`, or "" for no date. */
  value: string;
  /** The date as the viewer reads it, or the "Set date" prompt when empty. */
  display: string;
  /** A short note after the date, e.g. "8 days left". */
  hint?: string | null;
  /** Overrides the neutral/empty look, e.g. red when overdue. */
  tone?: string;
}) {
  return (
    <span
      className={cn(
        PILL,
        "gap-1.5 px-3",
        tone ?? (value ? PILL_NEUTRAL : PILL_EMPTY),
        className,
      )}
    >
      <CalendarDays aria-hidden className="size-3.5 shrink-0 opacity-70" />
      <span aria-hidden className="truncate">
        {display}
        {hint ? <span className="font-normal opacity-80"> · {hint}</span> : null}
      </span>
      <input
        type="date"
        value={value}
        onClick={(event) => {
          try {
            event.currentTarget.showPicker();
          } catch {
            // Older browsers, or a picker already open: the input still works.
          }
        }}
        className={cn(
          "absolute inset-0 h-full w-full min-w-full cursor-pointer appearance-none rounded-full bg-white px-3 text-sm text-sand-900 opacity-0",
          "focus:min-w-40 focus:opacity-100",
          FOCUS_RING,
          "disabled:cursor-not-allowed",
        )}
        {...props}
      />
    </span>
  );
}

/** How close a due date is, for an open task. More than two weeks out says nothing. */
const SOON_DAYS = 14;

/**
 * A task's start or due date. A due date on open work also says how close it
 * is, and turns red once past or amber on the day — from `daysFromToday`,
 * which counts the same UTC days as `isTaskOverdue`, so the pill and the
 * board's overdue state cannot disagree.
 */
export function TaskDatePill({
  value,
  todayIso,
  countdown,
  ...props
}: Omit<React.ComponentProps<typeof PillDate>, "display" | "hint" | "tone"> & {
  /** The viewer's day anchor from the server (invariant 15). */
  todayIso: string;
  /** Show "3 days left" / "2 days overdue": a due date on unfinished work. */
  countdown: boolean;
}) {
  const t = useT();
  const dateLocale = useDateLocale();
  const days = value && countdown ? daysFromToday(value, todayIso) : null;

  const hint =
    days === null
      ? null
      : days < 0
        ? t("tasks.fields.daysOverdue", { count: -days })
        : days === 0
          ? t("tasks.fields.dueToday")
          : days <= SOON_DAYS
            ? t("tasks.fields.daysLeft", { count: days })
            : null;
  const tone =
    days === null
      ? undefined
      : days < 0
        ? "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200/80 hover:bg-red-100/70"
        : days === 0
          ? "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200/80 hover:bg-amber-100/70"
          : undefined;

  // This year's dates drop the year: "30 Oct · 8 days left" fits a phone's
  // side panel where "30 Oct 2026 · 8 days left" was cut off. Another year
  // keeps it, because then it is the part that matters.
  const display = !value
    ? t("tasks.fields.setDate")
    : value.slice(0, 4) === todayIso.slice(0, 4)
      ? new Intl.DateTimeFormat(dateLocale, {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`))
      : formatDay(value, dateLocale);

  return (
    <PillDate
      value={value}
      display={display}
      hint={hint}
      tone={tone}
      {...props}
    />
  );
}

/** A number with its unit, e.g. "24 hours", as a pill around a plain input. */
export function PillNumber({
  icon,
  unit,
  value,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type" | "value"> & {
  icon?: React.ReactNode;
  unit: string;
  value: string;
}) {
  return (
    <span
      className={cn(
        PILL,
        "gap-1.5 px-3 focus-within:ring-2 focus-within:ring-brand-500",
        value ? PILL_NEUTRAL : PILL_EMPTY,
        className,
      )}
    >
      {icon ? (
        <span aria-hidden className="flex shrink-0 opacity-70">
          {icon}
        </span>
      ) : null}
      <input
        type="number"
        value={value}
        className="w-[4ch] min-w-0 bg-transparent text-right tabular-nums outline-hidden placeholder:text-sand-400 disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        {...props}
      />
      <span aria-hidden className="text-sand-500">
        {unit}
      </span>
    </span>
  );
}
