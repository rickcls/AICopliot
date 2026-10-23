"use client";

import { CalendarDays, ChevronDown } from "lucide-react";
import { useDateLocale, useT } from "@/components/i18n-provider";
import {
  STATUS_DOT,
  STATUS_PILL,
  daysFromToday,
  type TaskStatusColor,
} from "@/components/task-types";
import { DatePicker } from "@/components/date-picker";
import { ListboxMenu, useListbox, type PillOption } from "@/components/popover-menu";
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
 * A date and a number are still the native input underneath, so the platform
 * picker and the keyboard behave as before. A choice is a pill that opens its
 * own menu (`PillSelect`), because a native `<select>` opens the platform's
 * plain-text list — every status and priority drawn as the same grey words.
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

export type { PillOption };

/**
 * A choice drawn as a pill, opening a menu whose options look like what they
 * mean: a status in its column's colour, a priority as its badge, a person
 * with their avatar. The menu itself is `popover-menu.tsx`'s. The pill is named
 * by its row's label: give the `<label>` the id `${id}-label`, or pass
 * `aria-label`.
 */
export function PillSelect({
  id,
  value,
  options,
  onValueChange,
  icon,
  tone = PILL_NEUTRAL,
  placeholder,
  disabled,
  className,
  defaultOpen,
  onLeave,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: string;
  options: PillOption[];
  onValueChange: (value: string) => void;
  /** Leading glyph or avatar; decorative. */
  icon?: React.ReactNode;
  tone?: string;
  /** Shown when no option holds `value` — an action menu such as "Link a document…". */
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Open as soon as it appears — a cell that turned into an editor. */
  defaultOpen?: boolean;
  /** Focus left the pill and its menu together. */
  onLeave?: () => void;
  "aria-label"?: string;
}) {
  const { triggerRef, menuRef, listRef, api } = useListbox({
    id,
    options,
    value,
    disabled,
    onChoose: onValueChange,
    defaultOpen,
    onLeave,
  });
  const shown = options.find((option) => option.value === value)?.label ?? placeholder ?? "";

  return (
    <>
      <button
        ref={triggerRef}
        id={api.triggerId}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={api.open}
        aria-controls={api.listId}
        aria-label={ariaLabel ? `${ariaLabel}: ${shown}` : undefined}
        aria-labelledby={ariaLabel ? undefined : `${api.triggerId}-label ${api.triggerId}-value`}
        onClick={() => (api.open ? api.closeMenu(true) : api.openMenu())}
        onKeyDown={api.onTriggerKeyDown}
        onBlur={api.onBlur}
        className={cn(
          PILL,
          "cursor-pointer gap-1.5 pr-2.5 ring-1 ring-inset",
          icon ? "pl-2" : "pl-3",
          tone,
          FOCUS_RING,
          "disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
      >
        {icon ? (
          <span aria-hidden className="flex shrink-0 items-center">
            {icon}
          </span>
        ) : null}
        <span id={`${api.triggerId}-value`} className="min-w-0 truncate">
          {shown}
        </span>
        <ChevronDown
          aria-hidden
          className={cn("size-3.5 shrink-0 opacity-60 transition-transform", api.open && "rotate-180")}
        />
      </button>
      <ListboxMenu
        api={api}
        menuRef={menuRef}
        listRef={listRef}
        options={options}
        value={value}
        ariaLabel={ariaLabel}
        labelledBy={`${api.triggerId}-label`}
      />
    </>
  );
}

/** A task column as a tinted tag with its dot, the same colours as the list's group headings. */
export function StatusTag({ tone, label }: { tone: TaskStatusColor; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset",
        STATUS_PILL[tone],
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", STATUS_DOT[tone])} />
      {label}
    </span>
  );
}

/**
 * A date as a pill: "30 Oct 2026 · 8 days left", or a dashed "Set date".
 * Clicking it opens the month calendar (`DatePicker`) instead of the
 * platform's date input, which printed "dd/mm/yyyy" at rest and drew its own
 * picker.
 */
export function PillDate({
  value,
  display,
  hint,
  tone,
  className,
  ...props
}: Omit<React.ComponentProps<typeof DatePicker>, "children" | "className"> & {
  /** The date as the viewer reads it, or the "Set date" prompt when empty. */
  display: string;
  /** A short note after the date, e.g. "8 days left". */
  hint?: string | null;
  /** Overrides the neutral/empty look, e.g. red when overdue. */
  tone?: string;
  className?: string;
}) {
  return (
    <DatePicker
      value={value}
      className={cn(PILL, "gap-1.5 px-3", tone ?? (value ? PILL_NEUTRAL : PILL_EMPTY), className)}
      {...props}
    >
      <CalendarDays aria-hidden className="size-3.5 shrink-0 opacity-70" />
      <span className="truncate">
        {display}
        {hint ? <span className="font-normal opacity-80"> · {hint}</span> : null}
      </span>
    </DatePicker>
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
