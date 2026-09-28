"use client";

import * as React from "react";
import { Button } from "./ui";

/**
 * Replacement for the browser's `confirm()`.
 *
 * `confirm()` blocks the main thread, cannot be styled, renders the app's own
 * warning in OS chrome that looks like a browser security prompt, and — being
 * synchronous — some browsers suppress it outright in background tabs. It also
 * flattens every message to plain text, so "this deletes 12 tasks and 3
 * milestones" could not be emphasised.
 *
 * Built on the native `<dialog>` element rather than a hand-rolled overlay: the
 * browser supplies the focus trap, Escape handling, background inertness, and
 * top-layer painting. A `div` overlay would need all four written by hand, and
 * the top layer is what keeps it above the sticky `z-30` sidebar without a
 * z-index arms race.
 */

/**
 * The app-wide `FOCUS_RING` is `:focus-visible`, so a mouse click leaves no
 * ring — correct everywhere except here. This dialog is opened by clicking a
 * Delete button, and the browser then moves focus to Cancel without any
 * keyboard interaction having happened, so `:focus-visible` does not match and
 * nothing is drawn. The result is a keyboard trap whose exit is invisible and
 * an Enter key whose target cannot be seen. Focus is forced on the initially
 * focused control regardless of how the dialog was opened.
 */
const DIALOG_INITIAL_FOCUS_RING =
  "focus:outline-hidden focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 focus:ring-offset-white";

export interface ConfirmOptions {
  title: string;
  /** Optional detail. Naming what is destroyed is better than "are you sure?". */
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
}

const ConfirmContext = React.createContext<
  ((options: ConfirmOptions) => Promise<boolean>) | null
>(null);

export function useConfirm() {
  const confirm = React.useContext(ConfirmContext);
  if (!confirm) {
    throw new Error("useConfirm must be used within <ConfirmProvider>");
  }
  return confirm;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = React.useState<ConfirmOptions | null>(null);
  const dialogRef = React.useRef<HTMLDialogElement>(null);

  // The pending promise lives in a ref, not state: a state updater must be pure,
  // and resolving from inside one would fire twice under StrictMode.
  const settleRef = React.useRef<((confirmed: boolean) => void) | null>(null);

  const confirm = React.useCallback(
    (next: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        // A second request supersedes the first; leaving it unsettled would
        // hang whichever handler was awaiting it.
        settleRef.current?.(false);
        settleRef.current = resolve;
        setOptions(next);
      }),
    [],
  );

  const settle = React.useCallback((confirmed: boolean) => {
    const resolve = settleRef.current;
    settleRef.current = null;
    setOptions(null);
    resolve?.(confirmed);
  }, []);

  // `open` as a prop renders a non-modal dialog, so visibility is driven
  // imperatively — showModal() is what creates the backdrop and focus trap.
  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (options && !dialog.open) dialog.showModal();
    if (!options && dialog.open) dialog.close();
  }, [options]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <dialog
        ref={dialogRef}
        aria-labelledby="confirm-dialog-title"
        // Escape fires `close` without going through a button.
        onClose={() => settle(false)}
        onClick={(event) => {
          // The backdrop is part of the dialog box itself, so a click landing on
          // the element rather than the panel inside it is a click outside.
          if (event.target === dialogRef.current) settle(false);
        }}
        className="m-auto w-[calc(100vw-2rem)] max-w-md rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl open:animate-dialog-in backdrop:bg-black/50 backdrop:animate-overlay-in"
      >
        {options ? (
          <div className="p-5">
            <h2
              id="confirm-dialog-title"
              className="text-sm font-semibold text-slate-900"
            >
              {options.title}
            </h2>
            {options.body ? (
              <div className="mt-2 text-sm text-slate-600">{options.body}</div>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                className={DIALOG_INITIAL_FOCUS_RING}
                // Focus starts on the safe choice, so Enter never confirms a
                // deletion the user has not read.
                autoFocus
                onClick={() => settle(false)}
              >
                {options.cancelLabel ?? "Cancel"}
              </Button>
              <Button
                type="button"
                variant={options.tone === "danger" ? "danger" : "primary"}
                onClick={() => settle(true)}
              >
                {options.confirmLabel ?? "Confirm"}
              </Button>
            </div>
          </div>
        ) : null}
      </dialog>
    </ConfirmContext.Provider>
  );
}
