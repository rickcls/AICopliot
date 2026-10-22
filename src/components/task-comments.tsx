"use client";

import { useEffect, useState } from "react";
import { Avatar, Button, Spinner } from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
import { useDateLocale, useT, useTimeZone } from "@/components/i18n-provider";
import type { TaskCommentRow } from "@/components/task-types";
import { cn, formatDate } from "@/lib/utils";

/**
 * Discussion on one task.
 *
 * Comments are plain human content: they carry no source/generationStatus, are
 * never proposals awaiting review, and are not grounding evidence for project
 * chat — letting free-text commentary answer a question would put unreviewed
 * opinion behind a citation.
 *
 * Posting is optimistic-free on purpose. A comment is a durable statement
 * attributed to you by name, so it appears once the server has actually stored
 * it rather than being drawn immediately and quietly vanishing on failure.
 *
 * The thread is fetched when the panel opens rather than riding along with
 * every task on the board. The panel is keyed on the task, so reopening one
 * remounts this and always shows the stored thread.
 */
export function TaskComments({
  taskId,
  currentUserId,
}: {
  taskId: string;
  currentUserId: string;
}) {
  const [comments, setComments] = useState<TaskCommentRow[] | null>(null);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();
  const t = useT();
  const dateLocale = useDateLocale();
  const timeZone = useTimeZone();

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/tasks/${taskId}/comments`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error ?? t("tasks.comments.loadFailed"));
        setComments(data.comments);
      })
      .catch((cause: Error) => {
        if (controller.signal.aborted) return;
        setError(cause.message || t("tasks.comments.loadFailed"));
        setComments([]);
      });
    return () => controller.abort();
  }, [taskId, t]);

  async function post(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || posting) return;

    setPosting(true);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmed }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? t("tasks.comments.postFailed"));
        return;
      }
      setComments((current) => [...(current ?? []), data.comment]);
      setBody("");
    } catch {
      setError(t("common.couldNotReach"));
    } finally {
      setPosting(false);
    }
  }

  async function remove(comment: TaskCommentRow) {
    const confirmed = await confirm({
      title: t("tasks.comments.deleteTitle"),
      body: <p className="line-clamp-3">“{comment.body}”</p>,
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!confirmed) return;

    setBusyId(comment.id);
    setError(null);
    try {
      const response = await fetch(
        `/api/tasks/${taskId}/comments/${comment.id}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? t("tasks.comments.deleteFailed"));
        return;
      }
      setComments((current) =>
        (current ?? []).filter((item) => item.id !== comment.id),
      );
    } catch {
      setError(t("common.couldNotReach"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-sand-500 uppercase">
        {t("tasks.comments.title")}
        {comments && comments.length > 0 ? (
          <span className="ml-1.5 font-normal text-sand-400 tabular-nums">
            {comments.length}
          </span>
        ) : null}
      </h3>

      {error ? (
        <p role="alert" className="mb-2 text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}

      {comments === null ? (
        <p className="mb-3 flex items-center gap-2 text-xs text-sand-400">
          <Spinner /> {t("tasks.comments.loading")}
        </p>
      ) : comments.length === 0 ? (
        <p className="mb-3 text-xs text-sand-400">{t("tasks.comments.empty")}</p>
      ) : (
        <ul className="mb-3 space-y-3">
          {comments.map((comment) => {
            const mine = comment.author?.id === currentUserId;

            return (
              <li
                key={comment.id}
                className={cn(
                  "flex gap-2.5",
                  busyId === comment.id && "pointer-events-none opacity-60",
                )}
              >
                <Avatar
                  name={comment.author?.name ?? null}
                  // A removed author has no email to key the colour from, so the
                  // placeholder is stable rather than random.
                  email={comment.author?.email ?? "removed@—"}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-xs font-semibold text-sand-900">
                      {comment.author?.name ??
                        comment.author?.email ??
                        t("tasks.comments.formerMember")}
                    </span>
                    <time
                      dateTime={comment.createdAt}
                      className="text-xs text-sand-400"
                    >
                      {formatDate(comment.createdAt, dateLocale, timeZone)}
                    </time>
                    {mine ? (
                      <button
                        type="button"
                        onClick={() => void remove(comment)}
                        className="text-xs text-sand-400 transition-colors hover:text-red-700"
                      >
                        {t("common.delete")}
                      </button>
                    ) : null}
                  </div>
                  {/* `whitespace-pre-wrap` so the paragraph breaks somebody
                      typed are the paragraph breaks everybody reads. */}
                  <p className="mt-0.5 text-sm whitespace-pre-wrap text-sand-700">
                    {comment.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={post} className="space-y-2">
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            // Enter alone inserts a newline — comments are prose and often run
            // to several lines. Cmd/Ctrl+Enter is the send shortcut.
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void post(event);
            }
          }}
          placeholder={t("tasks.comments.placeholder")}
          rows={2}
          maxLength={4000}
          disabled={posting}
          aria-label={t("tasks.comments.label")}
          className={cn(
            "w-full rounded-lg border border-sand-200 bg-white px-2.5 py-2 text-sm text-sand-700",
            "placeholder:text-sand-400 focus-visible:border-sand-900 focus-visible:outline-hidden",
          )}
        />
        {body.trim() ? (
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setBody("")}
              disabled={posting}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={posting}>
              {posting ? (
                <>
                  <Spinner inverse className="size-3" />
                  {t("tasks.comments.posting")}
                </>
              ) : (
                t("tasks.comments.post")
              )}
            </Button>
          </div>
        ) : null}
      </form>
    </div>
  );
}
