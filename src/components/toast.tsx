"use client";

import * as React from "react";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "./ui";

/**
 * Transient confirmation for actions whose result is otherwise invisible.
 *
 * Failures already surface inline through `ErrorState`, and that stays the
 * primary channel — a toast is a supplement, never the only place a problem is
 * reported, because it disappears. What was missing is the success half:
 * approving a batch of requirements or reassigning a document only refreshed a
 * list, which is indistinguishable from nothing having happened.
 */

type ToastTone = "success" | "error" | "info";

interface ToastRecord {
  id: number;
  tone: ToastTone;
  message: string;
  description?: string;
}

/** Long enough to read a sentence; errors get longer because they matter more. */
const DURATION: Record<ToastTone, number> = {
  success: 5000,
  info: 5000,
  error: 9000,
};

/** Beyond this the stack becomes a wall that covers the page it describes. */
const MAX_VISIBLE = 3;

const TONE_STYLES: Record<ToastTone, { box: string; icon: string }> = {
  success: {
    box: "border-emerald-200 bg-emerald-50 text-emerald-900",
    icon: "text-emerald-600",
  },
  error: { box: "border-red-200 bg-red-50 text-red-900", icon: "text-red-600" },
  info: {
    box: "border-slate-200 bg-white text-slate-900",
    icon: "text-slate-500",
  },
};

const TONE_ICONS: Record<ToastTone, React.ComponentType<{ className?: string }>> =
  {
    success: CircleCheck,
    error: CircleAlert,
    info: Info,
  };

export interface Toaster {
  success: (message: string, description?: string) => void;
  error: (message: string, description?: string) => void;
  info: (message: string, description?: string) => void;
}

const ToastContext = React.createContext<Toaster | null>(null);

export function useToast() {
  const toast = React.useContext(ToastContext);
  if (!toast) throw new Error("useToast must be used within <ToastProvider>");
  return toast;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([]);
  const nextId = React.useRef(0);

  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = React.useCallback(
    (tone: ToastTone, message: string, description?: string) => {
      const id = nextId.current++;
      setToasts((current) =>
        [...current, { id, tone, message, description }].slice(-MAX_VISIBLE),
      );
    },
    [],
  );

  const toaster = React.useMemo<Toaster>(
    () => ({
      success: (message, description) => push("success", message, description),
      error: (message, description) => push("error", message, description),
      info: (message, description) => push("info", message, description),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={toaster}>
      {children}
      {/* The live region is always mounted. A region added to the DOM at the
          same moment as its content is not reliably announced. */}
      <ol
        aria-live="polite"
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-96"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </ol>
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastRecord;
  onDismiss: (id: number) => void;
}) {
  // WCAG 2.2.2: auto-dismissing content must be pausable. Hovering or tabbing
  // into a toast holds it open, and the close button is the explicit escape.
  const [held, setHeld] = React.useState(false);
  const Icon = TONE_ICONS[toast.tone];
  const tone = TONE_STYLES[toast.tone];

  React.useEffect(() => {
    if (held) return;
    const timer = setTimeout(() => onDismiss(toast.id), DURATION[toast.tone]);
    return () => clearTimeout(timer);
  }, [held, toast.id, toast.tone, onDismiss]);

  return (
    <li
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className={cn(
        "pointer-events-auto flex w-full items-start gap-3 rounded-lg border px-4 py-3 shadow-lg animate-toast-in",
        tone.box,
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone.icon)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{toast.message}</p>
        {toast.description ? (
          <p className="mt-0.5 text-sm opacity-80">{toast.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className={cn(
          "-mr-1 shrink-0 rounded p-1 opacity-60 transition-opacity hover:opacity-100",
          FOCUS_RING,
        )}
      >
        <X className="size-4" />
      </button>
    </li>
  );
}
