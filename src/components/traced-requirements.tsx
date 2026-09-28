import { requirementStatusLabel } from "@/lib/pm/labels";
import Link from "next/link";
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
  empty = "Not traced to a requirement.",
}: {
  projectId: string;
  links: TracedRequirementRow[];
  empty?: string;
}) {
  if (links.length === 0) {
    return <span className="text-sm text-slate-400">{empty}</span>;
  }

  return (
    <ul className="flex flex-wrap gap-1.5">
      {links.map((link) => (
        <li key={link.id} className="min-w-0 max-w-full">
          <Link
            href={`/projects/${projectId}/requirements?req=${link.requirement.id}`}
            title={link.requirement.title}
            className={cn(
              "inline-flex max-w-full items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700 hover:border-slate-300 hover:text-slate-900",
              FOCUS_RING,
            )}
          >
            <span className="shrink-0 font-mono text-[11px] text-slate-500">
              {formatRequirementCode(link.requirement.sequence)}
            </span>
            <span className="min-w-0 truncate">{link.requirement.title}</span>
            {link.requirement.status !== "approved" ? (
              <span className="shrink-0 text-[11px] text-amber-700">
                {requirementStatusLabel(link.requirement.status)}
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
