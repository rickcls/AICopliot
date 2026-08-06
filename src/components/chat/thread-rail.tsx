"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import type { ThreadSummary } from "@/lib/chat/history";
import { formatThreadTime } from "@/lib/chat/relative-time";
import { Badge, FOCUS_RING } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Past conversations. One line per thread, following the house list pattern —
 * the project badge marks the exception (a project-scoped thread), rather than
 * every row carrying a "documents" pill that says nothing.
 */
export function ThreadRail({
  threads,
  activeId,
  nowIso,
  className,
  onNavigate,
}: {
  threads: ThreadSummary[];
  activeId: string | null;
  nowIso: string;
  className?: string;
  onNavigate?: () => void;
}) {
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
            return (
              <li key={thread.id}>
                <Link
                  href={`/chat/${thread.id}`}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "block rounded-lg px-2.5 py-2 transition-colors",
                    active ? "bg-slate-100" : "hover:bg-slate-50",
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
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
