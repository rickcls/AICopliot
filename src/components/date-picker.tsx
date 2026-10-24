"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useDateLocale, useT, useTimeZone } from "@/components/i18n-provider";
import { placeMenu, usePopoverDismiss } from "@/components/popover-menu";
import { FOCUS_RING } from "@/components/ui";
import {
  addUtcMonths,
  buildCalendarMonth,
  formatUtcMonth,
  moveCalendarFocus,
  parseIsoDay,
  startOfUtcMonth,
  toIsoDay,
  weekdayLabels,
} from "@/lib/pm/calendar";
import { localDateString } from "@/lib/time";
import { cn, formatDay } from "@/lib/utils";

/**
 * A date as a trigger that opens a month calendar, in place of the platform's
 * `<input type="date">` — which prints "24/10/2026" and opens a picker drawn by
 * the browser, different in every browser and in none of this app's colours.
 *
 * The trigger is the caller's (a pill, a form field): `children` is what it
 * shows. The value is the `YYYY-MM-DD` string a date field has always held, and
 * "" means no date, so the server-facing code does not change. The grid is the
 * Timeline calendar's own (`buildCalendarMonth`) — Monday first, built in UTC —
 * so the two cannot disagree about which day a date lands on.
 *
 * Keyboard: arrows move a day or a week, Home/End the ends of the week,
 * PageUp/PageDown a month, Enter picks, Escape closes and returns to the
 * trigger.
 */
export function DatePicker({
  id,
  value,
  onValueChange,
  disabled,
  className,
  children,
  defaultOpen,
  onLeave,
  todayIso,
  clearable = true,
  "aria-label": ariaLabel,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
  title,
}: {
  id?: string;
  /** `YYYY-MM-DD`, or "" for no date. */
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  /** The trigger's classes: a pill's, or a field's. */
  className?: string;
  /** What the trigger shows. */
  children: React.ReactNode;
  /** Open as soon as it appears — a cell that turned into an editor. */
  defaultOpen?: boolean;
  /** Focus left the trigger and its calendar together. */
  onLeave?: () => void;
  /** The viewer's day anchor from the server; without it, today where the viewer is. */
  todayIso?: string;
  /** Offer "Clear" while a date is set. */
  clearable?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  title?: string;
}) {
  const t = useT();
  const locale = useDateLocale();
  const timeZone = useTimeZone();
  const labelId = useId();
  const fallbackId = useId();
  const triggerId = id ?? fallbackId;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusPending = useRef(false);
  const [open, setOpen] = useState(false);
  const [today, setToday] = useState(todayIso ?? "");
  const [month, setMonth] = useState<Date>(() => startOfUtcMonth(parseIsoDay(value) ?? new Date(0)));
  const [focused, setFocused] = useState(value);

  function openPicker() {
    if (disabled) return;
    // Read when it opens, never during render: this is the one place that asks the clock.
    const anchor = todayIso ?? localDateString(timeZone, new Date());
    const start = parseIsoDay(value) ? value : anchor;
    setToday(anchor);
    setFocused(start);
    setMonth(startOfUtcMonth(parseIsoDay(start)!));
    focusPending.current = true;
    setOpen(true);
  }

  function closePicker(returnFocus: boolean) {
    const menu = menuRef.current;
    if (menu?.matches(":popover-open")) menu.hidePopover();
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function pick(iso: string) {
    closePicker(true);
    if (iso !== value) onValueChange(iso);
  }

  usePopoverDismiss(open, triggerRef, menuRef, () => closePicker(false), "auto");

  // The popover is shown once its calendar is in the DOM, then put beside the
  // trigger and given focus on the day it opens on.
  useEffect(() => {
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!open || !menu || !trigger) return;
    if (!menu.matches(":popover-open")) menu.showPopover();
    placeMenu(trigger, menu, "auto");
  }, [open, month]);

  useEffect(() => {
    if (!open || !focusPending.current) return;
    focusPending.current = false;
    menuRef.current?.querySelector<HTMLElement>(`[data-day="${focused}"]`)?.focus();
  }, [open, focused, month]);

  const started = useRef(false);
  useEffect(() => {
    if (!defaultOpen || started.current) return;
    started.current = true;
    openPicker();
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onGridKeyDown(event: React.KeyboardEvent) {
    const next = moveCalendarFocus(focused, event.key);
    if (!next) return;
    event.preventDefault();
    focusPending.current = true;
    setFocused(next);
    setMonth(startOfUtcMonth(parseIsoDay(next)!));
  }

  function onMenuKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "Escape") return;
    // Stopped here, so a modal around the trigger does not close as well.
    event.preventDefault();
    event.stopPropagation();
    closePicker(true);
  }

  /** Focus moving between the trigger and its own calendar is not leaving. */
  function onBlur(event: React.FocusEvent) {
    const next = event.relatedTarget as Node | null;
    if (next && (menuRef.current?.contains(next) || triggerRef.current?.contains(next))) return;
    onLeave?.();
  }

  const todayDate = parseIsoDay(today) ?? new Date(0);
  const grid = open ? buildCalendarMonth([], month, todayDate, locale) : null;
  const dayFormat = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" });
  // Roving tabindex: one day in the Tab order, the focused one or, when it is
  // in another month, the first of this one.
  const tabbable = grid?.weeks.flat().some((cell) => toIsoDay(cell.date) === focused && cell.inMonth)
    ? focused
    : toIsoDay(month);

  return (
    <>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        disabled={disabled}
        title={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        // Named by its row's label and then its date, the way a `PillSelect`
        // is: give the `<label>` the id `${id}-label`, or pass `aria-label`.
        aria-labelledby={labelledBy ?? (ariaLabel ? undefined : `${triggerId}-label ${triggerId}-value`)}
        aria-describedby={describedBy}
        onClick={() => (open ? closePicker(true) : openPicker())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            openPicker();
          }
        }}
        onBlur={onBlur}
        className={cn(
          "cursor-pointer disabled:cursor-not-allowed disabled:opacity-60",
          FOCUS_RING,
          className,
        )}
      >
        <span id={`${triggerId}-value`} className="contents">
          {children}
        </span>
      </button>

      <div
        ref={menuRef}
        popover="manual"
        role="dialog"
        aria-label={t("datePicker.chooseDate")}
        onKeyDown={onMenuKeyDown}
        onBlur={onBlur}
        className="inset-auto m-0 w-[17.5rem] rounded-2xl border border-sand-200/80 bg-white p-3 text-sand-900 shadow-xl animate-dialog-in"
      >
        {grid ? (
          <>
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                aria-label={t("datePicker.previousMonth")}
                onClick={() => setMonth(addUtcMonths(month, -1))}
                className={cn(
                  "grid size-8 place-items-center rounded-full text-sand-600 hover:bg-sand-100",
                  FOCUS_RING,
                )}
              >
                <ChevronLeft aria-hidden className="size-4" />
              </button>
              <p id={labelId} aria-live="polite" className="text-sm font-semibold">
                {formatUtcMonth(month, locale)}
              </p>
              <button
                type="button"
                aria-label={t("datePicker.nextMonth")}
                onClick={() => setMonth(addUtcMonths(month, 1))}
                className={cn(
                  "grid size-8 place-items-center rounded-full text-sand-600 hover:bg-sand-100",
                  FOCUS_RING,
                )}
              >
                <ChevronRight aria-hidden className="size-4" />
              </button>
            </div>

            <div role="grid" aria-labelledby={labelId} onKeyDown={onGridKeyDown}>
              <div role="row" className="grid grid-cols-7">
                {weekdayLabels(locale).map((name) => (
                  <div
                    key={name}
                    role="columnheader"
                    className="grid h-8 place-items-center text-xs font-medium text-sand-500"
                  >
                    {name}
                  </div>
                ))}
              </div>
              {grid.weeks.map((week) => (
                <div key={toIsoDay(week[0].date)} role="row" className="grid grid-cols-7">
                  {week.map((cell) => {
                    const iso = toIsoDay(cell.date);
                    const selected = iso === value;
                    return (
                      <div key={iso} role="gridcell" aria-selected={selected} className="grid place-items-center">
                        <button
                          type="button"
                          data-day={iso}
                          tabIndex={iso === tabbable ? 0 : -1}
                          aria-label={dayFormat.format(cell.date)}
                          aria-current={cell.isToday ? "date" : undefined}
                          onClick={() => pick(iso)}
                          onFocus={() => setFocused(iso)}
                          className={cn(
                            "grid size-9 place-items-center rounded-full text-sm tabular-nums transition-colors",
                            FOCUS_RING,
                            selected
                              ? "bg-brand-600 font-semibold text-white hover:bg-brand-700"
                              : cn(
                                  "hover:bg-sand-100",
                                  cell.inMonth ? "text-sand-900" : "text-sand-400",
                                  cell.isToday && "bg-sand-100 font-semibold ring-1 ring-sand-300 ring-inset",
                                ),
                          )}
                        >
                          {cell.dayOfMonth}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="mt-2 flex items-center justify-between border-t border-sand-100 pt-2">
              <button
                type="button"
                onClick={() => pick(today)}
                className={cn(
                  "rounded-lg px-2 py-1 text-sm font-medium text-sand-700 hover:bg-sand-100",
                  FOCUS_RING,
                )}
              >
                {t("datePicker.today")}
              </button>
              {clearable && value ? (
                <button
                  type="button"
                  onClick={() => pick("")}
                  className={cn(
                    "rounded-lg px-2 py-1 text-sm font-medium text-sand-500 hover:bg-sand-100 hover:text-sand-800",
                    FOCUS_RING,
                  )}
                >
                  {t("common.clear")}
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}

/**
 * A date as a form field — the calendar's trigger drawn like an `Input`, with
 * the date as the viewer reads it, or a prompt while it is empty. For a pill in
 * a task's property list, `PillDate` is the same picker in that look.
 */
export function DateField({
  value,
  placeholder,
  className,
  ...props
}: Omit<React.ComponentProps<typeof DatePicker>, "children" | "className"> & {
  placeholder?: string;
  className?: string;
}) {
  const t = useT();
  const locale = useDateLocale();
  return (
    <DatePicker
      value={value}
      className={cn(
        "inline-flex h-10 max-w-full min-w-0 items-center gap-2 rounded-xl border border-sand-300 bg-white px-3 text-left text-sm text-sand-900",
        "transition-colors hover:bg-sand-50 focus-visible:border-brand-500",
        className,
      )}
      {...props}
    >
      <CalendarDays aria-hidden className="size-4 shrink-0 text-sand-400" />
      <span className={cn("truncate", !value && "text-sand-400")}>
        {value ? formatDay(value, locale) : (placeholder ?? t("tasks.fields.setDate"))}
      </span>
    </DatePicker>
  );
}
