"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, MessageSquarePlus } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { useToast } from "@/components/toast";
import { FOCUS_RING, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * What a Today row or a plan item ends in: a note button that opens the
 * check-in strip, and a tick.
 *
 * The tick is one click to "this task is done" — the same `done` answer the
 * strip's button gives, through the same check-in route and so the board's own
 * write path. It used to take two clicks (Update, then a button saying "Done"),
 * and that word was read as "finished updating" rather than "move this task to
 * Done". A click that moves real work needs a way back, so the toast carries an
 * Undo, which puts the task in the column it came from with the ordinary status
 * update — `previousStatusId` is what the route reports for that.
 *
 * The note button is an icon rather than the word "Update": the tick is what
 * the row is for, and the note is the quieter second thing.
 */
export function CheckInActions({
  taskId,
  title,
  open,
  onToggle,
  controls,
}: {
  taskId: string;
  title: string;
  /** Whether the strip this opens is showing. */
  open: boolean;
  onToggle: () => void;
  /** The id of the strip, for `aria-controls`. */
  controls: string;
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function undo(statusId: string) {
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statusId }),
      });
      if (!response.ok) {
        toast.error(t("checkIn.undoFailed"));
        return;
      }
      toast.success(t("checkIn.restored"));
      router.refresh();
    } catch {
      toast.error(t("common.couldNotReach"));
    }
  }

  async function markDone() {
    setBusy(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}/check-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "done" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(t("checkIn.failed"), data.error);
        return;
      }
      const previous: string | null = data.previousStatusId ?? null;
      toast.success(
        t("checkIn.markedDone"),
        title,
        previous ? { label: t("checkIn.undo"), onClick: () => void undo(previous) } : undefined,
      );
      router.refresh();
    } catch {
      toast.error(t("common.couldNotReach"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={controls}
        aria-label={t("checkIn.actions", { title })}
        title={t("checkIn.update")}
        className={cn(
          "grid size-7 place-items-center rounded-full transition-colors",
          open
            ? "bg-sand-200 text-sand-900"
            : "text-sand-500 hover:bg-sand-100 hover:text-sand-800",
          FOCUS_RING,
        )}
      >
        <MessageSquarePlus aria-hidden className="size-4" />
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void markDone()}
        aria-label={t("checkIn.markDone", { title })}
        title={t("checkIn.markDoneHint")}
        className={cn(
          // An empty ring that fills green on hover, as every to-do list draws
          // it. Green is the Done column's colour, not the brand's.
          "grid size-7 place-items-center rounded-full border border-sand-400 bg-white text-sand-400 transition-colors",
          "hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-600",
          "disabled:cursor-wait disabled:opacity-70",
          FOCUS_RING,
        )}
      >
        {busy ? <Spinner className="size-3.5" /> : <Check aria-hidden className="size-4" strokeWidth={2.75} />}
      </button>
    </span>
  );
}
