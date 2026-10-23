"use client";

import { Children, Fragment, isValidElement, useState } from "react";
import { ChevronDown } from "lucide-react";
import { ListboxMenu, useListbox, type PillOption } from "@/components/popover-menu";
import { FOCUS_RING } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * A form choice that opens the app's own menu instead of the platform's plain
 * list. It takes `<option>` and `<optgroup>` children and an `onChange` that
 * reads `event.target.value`, exactly as the native `<select>` it replaces, so
 * a field can move over without being rewritten. A choice that deserves richer
 * options — a status as its tag, a person with an avatar — is a `PillSelect`
 * with `options` instead.
 *
 * The trigger is a button with the `combobox` role, so a `<label htmlFor>`
 * names it and its text is the value a screen reader reads.
 */

/** The text inside an `<option>`, which React may hand over as an array of pieces. */
function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

interface OptionProps {
  value?: string | number;
  disabled?: boolean;
  label?: string;
  children?: React.ReactNode;
}

function readOptions(children: React.ReactNode, group?: string, out: PillOption[] = []): PillOption[] {
  Children.forEach(children, (child) => {
    if (!isValidElement<OptionProps>(child)) return;
    if (child.type === "option") {
      const label = textOf(child.props.children);
      out.push({
        value: child.props.value !== undefined ? String(child.props.value) : label,
        label,
        disabled: child.props.disabled,
        group,
      });
    } else if (child.type === "optgroup") {
      readOptions(child.props.children, child.props.label, out);
    } else if (child.type === Fragment) {
      readOptions(child.props.children, group, out);
    }
  });
  return out;
}

/** Past this, the widest label is not worth measuring — a time-zone list is not a column of choices. */
const MEASURE_LIMIT = 40;

export function Select({
  id,
  className,
  children,
  value,
  defaultValue,
  name,
  disabled,
  onChange,
  onBlur,
  onKeyDown,
  defaultOpen,
  ref,
  "aria-label": ariaLabel,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
  title,
}: {
  id?: string;
  className?: string;
  children?: React.ReactNode;
  value?: string;
  defaultValue?: string;
  name?: string;
  disabled?: boolean;
  onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  /** Focus left the field and its menu. */
  onBlur?: () => void;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  /** Open as soon as it appears — a cell that turned into an editor. */
  defaultOpen?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  title?: string;
}) {
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = value ?? inner;
  const options = readOptions(children);
  const shown = options.find((option) => option.value === current)?.label ?? "";

  function choose(next: string) {
    if (value === undefined) setInner(next);
    // Only `target.value` and `name` are ever read off a select's change event.
    const target = { value: next, name: name ?? "", id: id ?? "" };
    onChange?.({ target, currentTarget: target } as unknown as React.ChangeEvent<HTMLSelectElement>);
  }

  const { triggerRef, menuRef, listRef, api } = useListbox({
    id,
    options,
    value: current,
    disabled,
    onChoose: choose,
    defaultOpen,
    onLeave: onBlur,
    onKeyDown,
  });

  return (
    <>
      <button
        ref={(node) => {
          triggerRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        id={api.triggerId}
        type="button"
        role="combobox"
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={api.open}
        aria-controls={api.listId}
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        onClick={() => (api.open ? api.closeMenu(true) : api.openMenu())}
        onKeyDown={api.onTriggerKeyDown}
        onBlur={api.onBlur}
        className={cn(
          "inline-flex h-10 max-w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-xl border border-sand-300 bg-white px-3 text-left text-sm text-sand-900",
          "transition-colors hover:bg-sand-50 focus-visible:border-brand-500",
          FOCUS_RING,
          "disabled:cursor-not-allowed disabled:bg-sand-50 disabled:hover:bg-sand-50",
          className,
        )}
      >
        {/* Every label stacked in one cell, only the current one visible, so the
            field is as wide as its widest choice and does not jump when the
            value changes — as a native select does not. */}
        <span className="grid min-w-0 flex-1">
          {options.length <= MEASURE_LIMIT
            ? options.map((option, index) => (
                <span
                  key={`${option.value}-${index}`}
                  aria-hidden
                  className="invisible col-start-1 row-start-1 truncate"
                >
                  {option.label}
                </span>
              ))
            : null}
          <span className="col-start-1 row-start-1 truncate">{shown}</span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn("size-4 shrink-0 text-sand-500 transition-transform", api.open && "rotate-180")}
        />
      </button>
      {name ? <input type="hidden" name={name} value={current} /> : null}
      <ListboxMenu
        api={api}
        menuRef={menuRef}
        listRef={listRef}
        options={options}
        value={current}
        ariaLabel={ariaLabel}
        labelledBy={labelledBy}
      />
    </>
  );
}
