"use client";

import { useState } from "react";
import Link from "next/link";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { ThreadSummary } from "@/lib/chat/history";
import { formatThreadTime } from "@/lib/chat/relative-time";
import { Badge, FOCUS_RING, Input } from "@/components/ui";
import { cn } from "@/lib/utils";

const ROW_ACTION = cn(
  "grid size-7 shrink-0 place-items-center rounded-md text-slate-400 transition",
  // Revealed on hover or keyboard focus. Touch screens have no hover, so they
  // always show the actions rather than hiding them behind a gesture.
  "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100",
  FOCUS_RING,
);

/**
 * Past conversations. One line per thread, following the house list pattern —
 * the project badge marks the exception (a project-scoped thread), rather than
 * every row carrying a "documents" pill that says nothing.
 *
 * Rename is inline: Enter or leaving the field saves, Escape abandons, and an
 * emptied name is treated as a cancelled edit, as a task title is.
 */
export function ThreadRail({
  threads,
  activeId,
  nowIso,
  className,
  onNavigate,
  onRename,
  onDelete,
}: {
  threads: ThreadSummary[];
  activeId: string | null;
  nowIso: string;
  className?: string;
  onNavigate?: () => void;
  onRename: (thread: ThreadSummary, title: string) => Promise<void>;
  onDelete: (thread: ThreadSummary) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function commit(thread: ThreadSummary) {
    const title = draftTitle.trim();
    setEditingId(null);
    if (!title || title === thread.title) return;
    setBusyId(thread.id);
    try {
      await onRename(thread, title);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <nav aria-label="Conversations" className={className}>
      <Link
        href="/chat"
        onClick={onNavigate}
        className={cn(
          "flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3",
          "text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50",
          FOCUS_RING,
        )}
      >
        <Plus className="size-4 text-slate-400" aria-hidden />
        New thread
      </Link>

      {threads.length === 0 ? (
        <p className="mt-4 px-1 text-xs text-slate-500">
          Your conversations will be listed here.
        </p>
      ) : (
        <ul className="mt-3 space-y-0.5">
          {threads.map((thread) => {
            const active = thread.id === activeId;
            const busy = busyId === thread.id;

            if (editingId === thread.id) {
              return (
                <li key={thread.id} className="px-1 py-1">
                  <Input
                    value={draftTitle}
                    aria-label="Thread name"
                    maxLength={120}
                    autoFocus
                    onChange={(event) => setDraftTitle(event.target.value)}
                    onBlur={() => void commit(thread)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void commit(thread);
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        setEditingId(null);
                      }
                    }}
                    className="h-8 text-sm"
                  />
                </li>
              );
            }

            return (
              <li
                key={thread.id}
                className={cn(
                  "group flex items-start gap-0.5 rounded-lg transition-colors",
                  active ? "bg-slate-100" : "hover:bg-slate-50",
                  busy && "opacity-60",
                )}
              >
                <Link
                  href={`/chat/${thread.id}`}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "block min-w-0 flex-1 rounded-lg px-2.5 py-2",
                    FOCUS_RING,
                  )}
                >
                  <span
                    className={cn(
                      "block truncate text-sm",
                      active
                        ? "font-medium text-slate-900"
                        : "text-slate-700",
                    )}
                  >
                    {thread.title}
                  </span>
                  <span className="mt-1 flex items-center gap-1.5">
                    {thread.projectName ? (
                      <Badge tone="info" className="max-w-[9rem] truncate">
                        {thread.projectName}
                      </Badge>
                    ) : null}
                    <span className="text-xs text-slate-400">
                      {formatThreadTime(thread.lastMessageAt, nowIso)}
                    </span>
                  </span>
                </Link>
                <div className="flex shrink-0 items-center pt-1.5 pr-1">
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Rename “${thread.title}”`}
                    onClick={() => {
                      setDraftTitle(thread.title);
                      setEditingId(thread.id);
                    }}
                    className={cn(ROW_ACTION, "hover:bg-slate-200 hover:text-slate-700")}
                  >
                    <Pencil className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Delete “${thread.title}”`}
                    onClick={async () => {
                      setBusyId(thread.id);
                      try {
                        await onDelete(thread);
                      } finally {
                        setBusyId(null);
                      }
                    }}
                    className={cn(ROW_ACTION, "hover:bg-red-50 hover:text-red-700")}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
