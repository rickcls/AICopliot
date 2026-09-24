import Link from "next/link";
import { Check } from "lucide-react";
import type { RequirementRow } from "@/components/requirements-panel";
import { Badge, type BadgeTone, FOCUS_RING } from "@/components/ui";
import { formatRequirementCode } from "@/lib/pm/rules";
import {
  countDeliveryStates,
  deliveryState,
  DELIVERY_STATE_LABEL,
  DELIVERY_STATES,
  type DeliveryState,
} from "@/lib/pm/traceability";
import { cn } from "@/lib/utils";

const DELIVERY_TONE: Record<DeliveryState, BadgeTone> = {
  no_task: "danger",
  planned: "neutral",
  partial: "info",
  delivered: "success",
};

function Cell({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2.5 align-top">{children}</td>;
}

function None() {
  return <span className="text-slate-300">—</span>;
}

/**
 * Requirement → delivery, one row per requirement.
 *
 * Rows are the register's current filter, so searching or picking a status
 * narrows the matrix the same way it narrows the list. Rejected requirements
 * are dropped: rejected scope has nothing to trace.
 *
 * Delivery state is only claimed for approved scope. A draft with a task
 * linked is still a draft; calling it "Delivered" would read as agreed.
 */
export function TraceabilityMatrix({
  projectId,
  requirements,
  onOpen,
}: {
  projectId: string;
  requirements: RequirementRow[];
  onOpen: (id: string) => void;
}) {
  const rows = requirements.filter((row) => row.status !== "rejected");
  const approved = rows.filter((row) => row.status === "approved");
  const counts = countDeliveryStates(approved);
  const mustWithoutTask = approved.filter(
    (row) => row.priority === "must" && deliveryState(row.links) === "no_task",
  ).length;
  const base = `/projects/${projectId}`;

  if (rows.length === 0) {
    return (
      <p className="px-6 py-12 text-center text-sm text-slate-500">
        No requirements to trace in this view.
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
        {approved.length === 0 ? (
          <span>
            Nothing here is approved yet, so no delivery state is claimed.
          </span>
        ) : (
          <>
            <span className="font-medium text-slate-700">
              {approved.length} approved:
            </span>
            {DELIVERY_STATES.map((state) => (
              <span key={state} className="tabular-nums">
                {counts[state]} {DELIVERY_STATE_LABEL[state].toLowerCase()}
              </span>
            ))}
            {mustWithoutTask > 0 ? (
              <span className="font-medium text-red-700">
                {mustWithoutTask} Must-have with no task
              </span>
            ) : null}
          </>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] table-fixed border-collapse text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
            <tr>
              <th scope="col" className="w-[30%] px-3 py-2 font-medium">
                Requirement
              </th>
              <th scope="col" className="w-20 px-3 py-2 font-medium">
                Priority
              </th>
              <th scope="col" className="w-[24%] px-3 py-2 font-medium">
                Tasks
              </th>
              <th scope="col" className="w-[16%] px-3 py-2 font-medium">
                Milestones
              </th>
              <th scope="col" className="w-[16%] px-3 py-2 font-medium">
                Risks
              </th>
              <th scope="col" className="w-28 px-3 py-2 font-medium">
                Delivery
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const tasks = row.links.filter((link) => link.task);
              const milestones = row.links.filter((link) => link.milestone);
              const risks = row.links.filter((link) => link.risk);
              const state = deliveryState(row.links);
              const isApproved = row.status === "approved";

              return (
                <tr key={row.id} className="hover:bg-slate-50/60">
                  <Cell>
                    <button
                      type="button"
                      onClick={() => onOpen(row.id)}
                      className={cn(
                        "flex min-w-0 items-baseline gap-2 rounded text-left",
                        FOCUS_RING,
                      )}
                    >
                      <span className="shrink-0 font-mono text-xs text-slate-500">
                        {formatRequirementCode(row.sequence)}
                      </span>
                      <span className="min-w-0 text-slate-900 hover:underline">
                        {row.title}
                      </span>
                    </button>
                    {!isApproved ? (
                      <span className="mt-0.5 block pl-14 text-xs text-amber-700">
                        {row.status.replaceAll("_", " ")}
                      </span>
                    ) : null}
                  </Cell>
                  <Cell>
                    <span
                      className={cn(
                        "text-xs capitalize",
                        row.priority === "must"
                          ? "font-semibold text-slate-900"
                          : "text-slate-500",
                      )}
                    >
                      {row.priority}
                    </span>
                  </Cell>
                  <Cell>
                    {tasks.length === 0 ? (
                      <None />
                    ) : (
                      <ul className="space-y-1">
                        {tasks.map((link) => (
                          <li key={link.id} className="flex items-start gap-1.5 text-xs">
                            {link.task!.status.category === "done" ? (
                              <Check
                                className="mt-0.5 size-3 shrink-0 text-emerald-600"
                                aria-label="done"
                              />
                            ) : (
                              <span
                                aria-hidden
                                className="mt-1.5 size-1.5 shrink-0 rounded-full bg-slate-300"
                              />
                            )}
                            <Link
                              href={`${base}/tasks?task=${link.task!.id}`}
                              className="min-w-0 text-slate-700 hover:underline"
                            >
                              {link.task!.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Cell>
                  <Cell>
                    {milestones.length === 0 ? (
                      <None />
                    ) : (
                      <ul className="space-y-1">
                        {milestones.map((link) => (
                          <li key={link.id} className="text-xs">
                            <Link
                              href={`${base}/timeline`}
                              className="text-slate-700 hover:underline"
                            >
                              {link.milestone!.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Cell>
                  <Cell>
                    {risks.length === 0 ? (
                      <None />
                    ) : (
                      <ul className="space-y-1">
                        {risks.map((link) => (
                          <li key={link.id} className="text-xs">
                            <Link
                              href={`${base}/risks`}
                              className="line-clamp-2 text-slate-700 hover:underline"
                            >
                              {link.risk!.description}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Cell>
                  <Cell>
                    {isApproved ? (
                      <Badge tone={DELIVERY_TONE[state]}>
                        {DELIVERY_STATE_LABEL[state]}
                      </Badge>
                    ) : (
                      <span className="text-xs text-slate-400">Not agreed</span>
                    )}
                  </Cell>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
