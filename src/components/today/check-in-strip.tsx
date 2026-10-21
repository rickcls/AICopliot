"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/i18n-provider";
import { useToast } from "@/components/toast";
import { Button, Input } from "@/components/ui";
import { cn } from "@/lib/utils";

export type CheckInAction = "done" | "progress" | "blocked" | "snooze";

/**
 * Saying where a task stands: an optional note and an answer. Shared by a Today
 * row and a day-plan item, so both write through the same check-in route —
 * which uses the board's own write path — and the page then re-renders from
 * the server, so buckets, counts and the plan's ticks stay one source of truth.
 */
export function CheckInStrip({
  id,
  taskId,
  allowSnooze,
  onSaved,
  className,
}: {
  id: string;
  taskId: string;
  /** Snooze is for a reminder about quiet work; elsewhere it has no meaning. */
  allowSnooze: boolean;
  onSaved: (action: CheckInAction) => void;
  /** The frame around it: a full-width band under a row by default. */
  className?: string;
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<CheckInAction | null>(null);

  async function report(action: CheckInAction) {
    setBusy(action);
    try {
      const response = await fetch(`/api/tasks/${taskId}/check-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(note.trim() && action !== "snooze" ? { note: note.trim() } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(t("checkIn.failed"), data.error);
        return;
      }
      toast.success(action === "snooze" ? t("checkIn.snoozed") : t("checkIn.saved"));
      setNote("");
      onSaved(action);
      router.refresh();
    } catch {
      toast.error(t("common.couldNotReach"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      id={id}
      className={cn(
        "flex flex-wrap items-center gap-2",
        className ?? "border-t border-sand-100 bg-sand-50/70 px-5 py-3",
      )}
    >
      <label htmlFor={`${id}-note`} className="sr-only">
        {t("checkIn.noteLabel")}
      </label>
      <Input
        id={`${id}-note`}
        value={note}
        maxLength={4000}
        placeholder={t("checkIn.notePlaceholder")}
        onChange={(event) => setNote(event.target.value)}
        className="h-8 min-w-0 flex-1 basis-56 text-xs"
      />
      <Button type="button" size="sm" disabled={busy !== null} onClick={() => void report("done")}>
        {t("checkIn.done")}
      </Button>
      <Button type="button" size="sm" variant="secondary" disabled={busy !== null} onClick={() => void report("progress")}>
        {t("checkIn.progress")}
      </Button>
      <Button type="button" size="sm" variant="secondary" disabled={busy !== null} onClick={() => void report("blocked")}>
        {t("checkIn.blocked")}
      </Button>
      {allowSnooze ? (
        <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => void report("snooze")}>
          {t("checkIn.snooze")}
        </Button>
      ) : null}
    </div>
  );
}
