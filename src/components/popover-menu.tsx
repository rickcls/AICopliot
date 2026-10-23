"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The menu behind every choice in the app — a pill, a form field, a filter —
 * and the popover a date picker opens. One implementation, so a status in the
 * task panel and a language in Settings open the same way.
 *
 * The menu is a `popover` in the top layer, so neither a scrolling panel nor a
 * modal dialog clips it, and it follows the WAI-ARIA listbox pattern: arrows
 * and Home/End move, Enter or Space picks, Escape closes and returns to the
 * trigger, and typing jumps to the next option starting with those letters.
 */

export interface PillOption {
  value: string;
  /** Plain text: the trigger's label, the typeahead, and the accessible name. */
  label: string;
  /** How the option is drawn in the menu — a status tag, a badge, an avatar. */
  content?: React.ReactNode;
  disabled?: boolean;
  /** The heading this option sits under; consecutive options share one. */
  group?: string;
}

/**
 * Where a menu opens: under its trigger, or above it when there is more room
 * there (a composer at the foot of the screen), kept inside the viewport.
 * Fixed coordinates, because the menu lives in the top layer.
 */
export function placeMenu(
  trigger: HTMLElement,
  menu: HTMLElement,
  /** A floor for the width, or "auto" to keep the menu's own — a calendar is not as wide as its field. */
  minWidth: number | "auto" = 208,
) {
  const box = trigger.getBoundingClientRect();
  const margin = 8;
  const gap = 6;
  if (minWidth !== "auto") menu.style.minWidth = `${Math.max(box.width, minWidth)}px`;
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
 * While a popover is open: a press anywhere else dismisses it, and it follows
 * its trigger when the page or the panel around it scrolls.
 */
export function usePopoverDismiss(
  open: boolean,
  triggerRef: React.RefObject<HTMLElement | null>,
  menuRef: React.RefObject<HTMLElement | null>,
  onDismiss: () => void,
  minWidth?: number | "auto",
) {
  const dismiss = useRef(onDismiss);
  useEffect(() => {
    dismiss.current = onDismiss;
  });

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      dismiss.current();
    };
    const follow = () => {
      if (menuRef.current && triggerRef.current) placeMenu(triggerRef.current, menuRef.current, minWidth);
    };
    document.addEventListener("pointerdown", close, true);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [open, triggerRef, menuRef, minWidth]);
}

export interface ListboxOptions {
  id?: string;
  options: PillOption[];
  value: string;
  disabled?: boolean;
  onChoose: (value: string) => void;
  /** Open as soon as it mounts — a cell that turned into an editor. */
  defaultOpen?: boolean;
  /** Focus left the trigger and its menu together, not just one for the other. */
  onLeave?: () => void;
  /** Sees every key pressed in the trigger or the open menu, before the menu's own handling. */
  onKeyDown?: (event: React.KeyboardEvent) => void;
}

type Listbox = ReturnType<typeof useListbox>;
export type ListboxApi = Listbox["api"];

export function useListbox({
  id,
  options,
  value,
  disabled,
  onChoose,
  defaultOpen,
  onLeave,
  onKeyDown,
}: ListboxOptions) {
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
    const menu = menuRef.current;
    if (menu?.matches(":popover-open")) menu.hidePopover();
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    closeMenu(true);
    if (option.value !== value) onChoose(option.value);
  }

  usePopoverDismiss(open, triggerRef, menuRef, () => closeMenu(false));

  const opened = useRef(false);
  useEffect(() => {
    if (!defaultOpen || opened.current) return;
    opened.current = true;
    openMenu();
    // Once, on mount; openMenu reads the options and value it was first given.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onTriggerKeyDown(event: React.KeyboardEvent) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openMenu();
    }
  }

  function onListKeyDown(event: React.KeyboardEvent) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
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
        // Stopped here, so a modal around the trigger does not close as well.
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
    const buffer = typed.current;
    const now = event.timeStamp;
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

  /** Focus moving between the trigger and its own menu is not leaving. */
  function onBlur(event: React.FocusEvent) {
    const next = event.relatedTarget as Node | null;
    if (next && (menuRef.current?.contains(next) || triggerRef.current?.contains(next))) return;
    onLeave?.();
  }

  // The refs are returned beside `api`, not inside it: the lint that forbids
  // reading a ref during render also flags a plain value read off an object
  // that holds one.
  return {
    triggerRef,
    menuRef,
    listRef,
    api: {
      triggerId,
      listId,
      optionId,
      open,
      active,
      setActive,
      openMenu,
      closeMenu,
      choose,
      onTriggerKeyDown,
      onListKeyDown,
      onBlur,
    },
  };
}

/** The popover and its listbox. The trigger is the caller's, so a pill and a field can share this. */
export function ListboxMenu({
  api,
  menuRef,
  listRef,
  options,
  value,
  ariaLabel,
  labelledBy,
}: {
  api: ListboxApi;
  menuRef: React.RefObject<HTMLDivElement | null>;
  listRef: React.RefObject<HTMLDivElement | null>;
  options: PillOption[];
  value: string;
  ariaLabel?: string;
  labelledBy?: string;
}) {
  // Options grouped under their headings, keeping each option's own index.
  const groups: { name?: string; items: { option: PillOption; index: number }[] }[] = [];
  options.forEach((option, index) => {
    const last = groups.at(-1);
    if (last && last.name === option.group) last.items.push({ option, index });
    else groups.push({ name: option.group, items: [{ option, index }] });
  });

  return (
    <div
      ref={menuRef}
      popover="manual"
      className="inset-auto m-0 max-h-72 w-max max-w-[min(22rem,calc(100vw-1rem))] overflow-y-auto rounded-2xl border border-sand-200/80 bg-white p-1.5 text-sand-900 shadow-xl animate-dialog-in"
    >
      <div
        ref={listRef}
        id={api.listId}
        role="listbox"
        tabIndex={-1}
        aria-labelledby={ariaLabel ? undefined : labelledBy}
        aria-label={ariaLabel}
        aria-activedescendant={api.open && api.active >= 0 ? api.optionId(api.active) : undefined}
        onKeyDown={api.onListKeyDown}
        onBlur={api.onBlur}
        className="outline-hidden"
      >
        {groups.map((group, groupIndex) => {
          const items = group.items.map(({ option, index }) => {
            const isSelected = option.value === value;
            return (
              <div
                key={`${option.value}-${index}`}
                id={api.optionId(index)}
                role="option"
                aria-selected={isSelected}
                aria-disabled={option.disabled || undefined}
                onPointerMove={() => {
                  if (!option.disabled && index !== api.active) api.setActive(index);
                }}
                onClick={() => api.choose(index)}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition-colors",
                  option.disabled ? "cursor-default opacity-50" : "cursor-pointer",
                  index === api.active && !option.disabled && "bg-sand-100",
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
          const headingId = `${api.listId}-group-${groupIndex}`;
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
  );
}
