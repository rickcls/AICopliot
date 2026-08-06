"use client";

import { useState } from "react";
import { Avatar, Button, Spinner } from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
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
 */
export function TaskComments({
  taskId,
  comments,
  currentUserId,
  onCommentsChange,
}: {
  taskId: string;
  comments: TaskCommentRow[];
  currentUserId: string;
  onCommentsChange: (comments: TaskCommentRow[]) => void;
}) {
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

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
        setError(data.error ?? "Could not post that comment.");
        return;
      }
      onCommentsChange([...comments, data.comment]);
      setBody("");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setPosting(false);
    }
  }

  async function remove(comment: TaskCommentRow) {
    const confirmed = await confirm({
      title: "Delete this comment?",
      body: <p className="line-clamp-3">“{comment.body}”</p>,
      confirmLabel: "Delete",
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
        setError(data.error ?? "Could not delete that comment.");
        return;
      }
      onCommentsChange(comments.filter((item) => item.id !== comment.id));
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        Comments
        {comments.length > 0 ? (
          <span className="ml-1.5 font-normal text-slate-400 tabular-nums">
            {comments.length}
          </span>
        ) : null}
      </h3>

      {error ? (
        <p role="alert" className="mb-2 text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}

      {comments.length === 0 ? (
        <p className="mb-3 text-xs text-slate-400">
          No comments yet. Notes here are for people — they are never used to
          answer questions in chat.
        </p>
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
                    <span className="text-xs font-semibold text-slate-900">
                      {comment.author?.name ??
                        comment.author?.email ??
                        "Former member"}
                    </span>
                    <time
                      dateTime={comment.createdAt}
                      className="text-[11px] text-slate-400"
                    >
                      {formatDate(comment.createdAt)}
                    </time>
                    {mine ? (
                      <button
                        type="button"
                        onClick={() => void remove(comment)}
                        className="text-[11px] text-slate-400 transition-colors hover:text-red-700"
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                  {/* `whitespace-pre-wrap` so the paragraph breaks somebody
                      typed are the paragraph breaks everybody reads. */}
                  <p className="mt-0.5 text-sm whitespace-pre-wrap text-slate-700">
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
          placeholder="Add a comment…"
          rows={2}
          maxLength={4000}
          disabled={posting}
          aria-label="Add a comment"
          className={cn(
            "w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-700",
            "placeholder:text-slate-400 focus-visible:border-slate-900 focus-visible:outline-hidden",
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
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={posting}>
              {posting ? (
                <>
                  <Spinner className="size-3 border-white/40 border-t-white" />
                  Posting…
                </>
              ) : (
                "Comment"
              )}
            </Button>
          </div>
        ) : null}
      </form>
    </div>
  );
}
