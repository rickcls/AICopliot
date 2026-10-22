"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { useDateLocale, useT } from "@/components/i18n-provider";
import {
  STATUS_DOT,
  STATUS_PILL,
  daysFromToday,
  type TaskStatusColor,
} from "@/components/task-types";
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

export interface PillOption {
  value: string;
  /** Plain text: the pill's label, the typeahead, and the accessible name. */
  label: string;
  /** How the option is drawn in the menu — a status tag, a badge, an avatar. */
  content?: React.ReactNode;
  disabled?: boolean;
  /** The heading this option sits under; consecutive options share one. */
  group?: string;
}

/**
 * Where the menu opens: under the pill, or above it when there is more room
 * there (a composer at the foot of the screen), kept inside the viewport.
 * Fixed coordinates, because the menu lives in the top layer.
 */
function placeMenu(trigger: HTMLElement, menu: HTMLElement) {
  const box = trigger.getBoundingClientRect();
  const margin = 8;
  const gap = 6;
  menu.style.minWidth = `${Math.max(box.width, 208)}px`;
  const height = menu.offsetHeight;
  const width = menu.offsetWidth;
  const below = window.innerHeight - box.bottom - margin;
  const above = box.top - margin;
  const top =
    below < height + gap && above > below
      ? Math.max(margin, box.top - height - gap)
      : box.bottom + gap;
  menu.style.top = `${top}px`;
  menu.style.left = `${Math.min(Math.max(margin, box.left), window.innerWidth - width - margin)}px`;
}

/**
 * A choice drawn as a pill, opening a menu whose options look like what they
 * mean: a status in its column's colour, a priority as its badge, a person
 * with their avatar.
 *
 * The menu is a `popover` in the top layer, so neither the task panel's
 * scrolling nor a modal dialog clips it, and it follows the WAI-ARIA listbox
 * pattern: arrows and Home/End move, Enter or Space picks, Escape closes and
 * returns to the pill, and typing jumps to the next option starting with
 * those letters. The pill is named by its row's label: give the `<label>`
 * the id `${id}-label`, or pass `aria-label`.
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
  "aria-label"?: string;
}) {
  const fallbackId = useId();
  const triggerId = id ?? fallbackId;
  const listId = `${triggerId}-menu`;
  const optionId = (index: number) => `${listId}-${index}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const selected = options.find((option) => option.value === value);
  const shown = selected?.label ?? placeholder ?? "";

  function activate(index: number) {
    setActive(index);
    document.getElementById(optionId(index))?.scrollIntoView({ block: "nearest" });
  }

  /** The next option that can be picked, from `from` in `step`, without wrapping. */
  function step(from: number, by: 1 | -1): number {
    for (let index = from + by; index >= 0 && index < options.length; index += by) {
      if (!options[index].disabled) return index;
    }
    return from;
  }

  function openMenu() {
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!menu || !trigger || disabled) return;
    if (!menu.matches(":popover-open")) menu.showPopover();
    placeMenu(trigger, menu);
    const current = options.findIndex((option) => option.value === value && !option.disabled);
    const start = current >= 0 ? current : step(-1, 1);
    setActive(start);
    setOpen(true);
    listRef.current?.focus();
    // After focus, so the browser does not scroll the page to the menu's top.
    requestAnimationFrame(() =>
      document.getElementById(optionId(start))?.scrollIntoView({ block: "nearest" }),
    );
  }

  function closeMenu(returnFocus: boolean) {
    menuRef.current?.hidePopover();
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    closeMenu(true);
    if (option.value !== value) onValueChange(option.value);
  }

  // While open: a press anywhere else closes it, and the menu follows the pill
  // when the page or the panel around it scrolls.
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      menuRef.current?.hidePopover();
      setOpen(false);
    };
    const follow = () => {
      if (menuRef.current && triggerRef.current) placeMenu(triggerRef.current, menuRef.current);
    };
    document.addEventListener("pointerdown", close, true);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [open]);

  function onMenuKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        activate(step(active, 1));
        return;
      case "ArrowUp":
        event.preventDefault();
        activate(step(active, -1));
        return;
      case "Home":
        event.preventDefault();
        activate(step(-1, 1));
        return;
      case "End":
        event.preventDefault();
        activate(step(options.length, -1));
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        choose(active);
        return;
      case "Escape":
        // Stopped here, so a modal around the pill does not close as well.
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
        return;
      case "Tab":
        closeMenu(false);
        return;
    }
    if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
    // Typeahead: letters typed in quick succession narrow the match.
    const now = event.timeStamp;
    const buffer = typed.current;
    buffer.text = now - buffer.at < 700 ? buffer.text + event.key.toLowerCase() : event.key.toLowerCase();
    buffer.at = now;
    const from = buffer.text.length === 1 ? active + 1 : active;
    for (let offset = 0; offset < options.length; offset += 1) {
      const index = (from + offset + options.length) % options.length;
      const option = options[index];
      if (!option.disabled && option.label.toLowerCase().startsWith(buffer.text)) {
        activate(index);
        return;
      }
    }
  }

  // Options grouped under their headings, keeping each option's own index.
  const groups: { name?: string; items: { option: PillOption; index: number }[] }[] = [];
  options.forEach((option, index) => {
    const last = groups.at(-1);
    if (last && last.name === option.group) last.items.push({ option, index });
    else groups.push({ name: option.group, items: [{ option, index }] });
  });

  return (
    <>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel ? `${ariaLabel}: ${shown}` : undefined}
        aria-labelledby={ariaLabel ? undefined : `${triggerId}-label ${triggerId}-value`}
        onClick={() => (open ? closeMenu(true) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu();
          }
        }}
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
        <span id={`${triggerId}-value`} className="min-w-0 truncate">
          {shown}
        </span>
        <ChevronDown
          aria-hidden
          className={cn("size-3.5 shrink-0 opacity-60 transition-transform", open && "rotate-180")}
        />
      </button>

      <div
        ref={menuRef}
        popover="manual"
        className="inset-auto m-0 max-h-72 w-max max-w-[min(22rem,calc(100vw-1rem))] overflow-y-auto rounded-2xl border border-sand-200/80 bg-white p-1.5 text-sand-900 shadow-xl animate-dialog-in"
      >
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={ariaLabel ? undefined : `${triggerId}-label`}
          aria-label={ariaLabel}
          aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
          onKeyDown={onMenuKeyDown}
          className="outline-hidden"
        >
          {groups.map((group, groupIndex) => {
            const items = group.items.map(({ option, index }) => {
              const isSelected = option.value === value;
              return (
                <div
                  key={`${option.value}-${index}`}
                  id={optionId(index)}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  onPointerMove={() => {
                    if (!option.disabled && index !== active) setActive(index);
                  }}
                  onClick={() => choose(index)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition-colors",
                    option.disabled ? "cursor-default opacity-50" : "cursor-pointer",
                    index === active && !option.disabled && "bg-sand-100",
                    isSelected && "font-medium",
                  )}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    {option.content ?? <span className="truncate">{option.label}</span>}
                  </span>
                  <Check
                    aria-hidden
                    className={cn("size-4 shrink-0 text-brand-600", !isSelected && "invisible")}
                  />
                </div>
              );
            });
            // Ungrouped options after a group get a hairline, or they would
            // read as the last items under its heading.
            if (!group.name) {
              return (
                <div
                  key={`group-${groupIndex}`}
                  className={cn(groupIndex > 0 && "mt-1 border-t border-sand-100 pt-1")}
                >
                  {items}
                </div>
              );
            }
            const headingId = `${listId}-group-${groupIndex}`;
            return (
              <div key={`group-${groupIndex}`} role="group" aria-labelledby={headingId}>
                <div
                  id={headingId}
                  className="px-2.5 pt-2.5 pb-1 text-xs font-semibold tracking-wide text-sand-500 uppercase"
                >
                  {group.name}
                </div>
                {items}
              </div>
            );
          })}
        </div>
      </div>
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
