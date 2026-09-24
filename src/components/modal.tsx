"use client";

import * as React from "react";
import { X } from "lucide-react";
import { FOCUS_RING } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * A centred modal panel, built on the native `<dialog>` element for the same
 * reasons as `confirm-dialog.tsx`: the browser supplies the focus trap, Escape
 * handling, background inertness, and top-layer painting. A `div` overlay would
 * need all four written by hand, and the top layer is what keeps it above the
 * sticky `z-30` sidebar without a z-index arms race.
 *
 * **A click on the backdrop does not close it.** That is the deliberate
 * difference from the confirmation dialog, which holds no user input and can be
 * dismissed freely. This one wraps a part-typed form, and the most common way to
 * lose that work is a stray click while reaching for a field. Escape still
 * closes, because a modal that traps focus without an obvious keyboard exit is
 * a trap — but Escape is a deliberate keypress, and a misplaced click is not.
 */
export function Modal({
  title,
  description,
  onClose,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();

  // `open` as a prop renders a *non-modal* dialog — no backdrop, no focus trap.
  // Only `showModal()` gives those, so visibility is driven imperatively. The
  // component mounts and unmounts with the thing it is showing, so this runs
  // once per opening.
  //
  // Initial focus is placed by hand rather than with React's `autoFocus`.
  // Child effects run before the parent's, so `autoFocus` fires while the
  // dialog is still `display: none` and the focus is discarded; `showModal()`
  // then runs its own algorithm and lands on the first focusable element, which
  // is the close button. The result was a form that opened with the X focused
  // and needed a Tab before you could type. `[data-autofocus]` is the opt-in.
  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      // Escape closes without going through the button, and fires `close`.
      onClose={onClose}
      className={cn(
        // Wide enough that the paired fields get a real measure each, and
        // capped by the viewport clause so it still fits a phone.
        "m-auto w-[calc(100vw-2rem)] max-w-4xl rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl",
        // Leaves a margin at both ends on a short viewport, so the panel never
        // runs off the top where its header — and the close button — would be
        // unreachable.
        "max-h-[calc(100dvh-4rem)]",
        "open:animate-dialog-in backdrop:animate-overlay-in backdrop:bg-black/50",
        className,
      )}
    >
      {/* The flex column lives on a wrapper, not the dialog: `display` on a
          `<dialog>` is what the UA toggles to hide it, so setting `flex` there
          would leave a closed dialog visible. `inherit` picks up the cap above
          so the body has a bounded height to scroll within. */}
      <div className="flex max-h-[inherit] flex-col">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-3.5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-semibold text-slate-900">
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 text-xs text-slate-500">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={cn(
              "-mr-1.5 -mt-0.5 grid size-7 shrink-0 place-items-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900",
              FOCUS_RING,
            )}
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        {children}
      </div>
    </dialog>
  );
}

/** Scrolling body of a modal. Separate so the header and footer stay put. */
export function ModalBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4", className)}
      {...props}
    />
  );
}

/** Action row of a modal, pinned below the scrolling body. */
export function ModalFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/60 px-5 py-3",
        className,
      )}
      {...props}
    />
  );
}
