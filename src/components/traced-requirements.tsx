"use client";

import Link from "next/link";
import { useT } from "@/components/i18n-provider";
import { requirementStatusLabel } from "@/lib/pm/labels";
import type { TracedRequirementRow } from "@/components/task-types";
import { FOCUS_RING } from "@/components/ui";
import { formatRequirementCode } from "@/lib/pm/rules";
import { cn } from "@/lib/utils";

/**
 * The requirements a task, milestone, or risk delivers against — the reverse
 * of the register's link editor, so traceability reads in both directions.
 * Each chip opens the register with that requirement expanded.
 */
export function TracedRequirements({
  projectId,
  links,
  empty,
}: {
  projectId: string;
  links: TracedRequirementRow[];
  empty?: string;
}) {
  const t = useT();
  if (links.length === 0) {
    return (
      <span className="text-sm text-sand-400">{empty ?? t("tasks.traced.empty")}</span>
    );
  }

  return (
    <ul className="flex flex-wrap gap-1.5">
      {links.map((link) => (
        <li key={link.id} className="min-w-0 max-w-full">
          <Link
            href={`/projects/${projectId}/requirements?req=${link.requirement.id}`}
            title={link.requirement.title}
            className={cn(
              "inline-flex max-w-full items-center gap-1.5 rounded-md border border-sand-200 bg-white px-2 py-0.5 text-xs text-sand-700 hover:border-sand-300 hover:text-sand-900",
              FOCUS_RING,
            )}
          >
            <span className="shrink-0 font-mono text-[11px] text-sand-500">
              {formatRequirementCode(link.requirement.sequence)}
            </span>
            <span className="min-w-0 truncate">{link.requirement.title}</span>
            {link.requirement.status !== "approved" ? (
              <span className="shrink-0 text-xs text-amber-700">
                {requirementStatusLabel(link.requirement.status, t)}
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
