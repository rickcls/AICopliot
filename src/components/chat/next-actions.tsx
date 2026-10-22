"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { nextActionsFor } from "@/lib/chat/next-actions";
import { useT } from "@/components/i18n-provider";
import { buttonClasses } from "@/components/ui";
import type { Citation } from "@/lib/schemas";

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
  const t = useT();
  const actions = nextActionsFor(citations, t);
  if (actions.length === 0) return null;

  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold tracking-wide text-sand-500 uppercase">
        {t("chat.next.title")}
      </h3>
      <div className="mt-2 flex flex-wrap gap-2">
        {actions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className={buttonClasses({
              variant: "secondary",
              size: "sm",
              className: "max-w-full gap-1.5",
            })}
          >
            <span className="truncate">{action.label}</span>
            <ArrowUpRight className="size-3.5 shrink-0 text-sand-400" aria-hidden />
          </Link>
        ))}
      </div>
    </div>
  );
}
