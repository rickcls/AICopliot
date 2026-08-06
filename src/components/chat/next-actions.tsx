"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { nextActionsFor } from "@/lib/chat/next-actions";
import { FOCUS_RING } from "@/components/ui";
import type { Citation } from "@/lib/schemas";
import { cn } from "@/lib/utils";

/**
 * Where an answer lets you go next, derived from its own evidence.
 *
 * Every href is either built from a document id or taken from a citation, whose
 * schema constrains it to an in-app path — so nothing here can become an
 * off-site link. A refusal cites nothing and therefore renders nothing.
 */
export function NextActions({
  citations,
}: {
  citations: Citation[];
}) {
  const actions = nextActionsFor(citations);
  if (actions.length === 0) return null;

  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
        Next
      </h3>
      <div className="mt-2 flex flex-wrap gap-2">
        {actions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className={cn(
              "inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3",
              "text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50",
              FOCUS_RING,
            )}
          >
            <span className="truncate">{action.label}</span>
            <ArrowUpRight className="size-3.5 shrink-0 text-slate-400" aria-hidden />
          </Link>
        ))}
      </div>
    </div>
  );
}
