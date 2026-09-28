"use client";

import { useState } from "react";
import { Check, Flag } from "lucide-react";
import { Button, Spinner } from "@/components/ui";
import { PRIORITY_FLAG } from "@/components/task-types";
import type { TaskProposal } from "@/lib/schemas";
import { cn, formatDay } from "@/lib/utils";

const FIELD_LABEL: Record<TaskProposal["field"], string> = {
  description: "Description",
  priority: "Priority",
  estimatedHours: "Estimate",
  startDate: "Start date",
  dueDate: "Due date",
};

function display(field: TaskProposal["field"], value: string | number | null) {
  if (value === null || value === "") return "—";
  if (field === "startDate" || field === "dueDate") return formatDay(String(value));
  if (field === "estimatedHours") return `${value} h`;
  return String(value);
}

/** The value a task field holds, in the proposal's terms, for comparison. */
export type CurrentTaskValues = Partial<Record<TaskProposal["field"], string | number | null>>;

/**
 * One edit an answer proposes, and the button that makes it.
 *
 * The card is the whole review: what would change, what it is now, and the
 * passages that say so. Apply is the only write — the chat itself never
 * changes a task — and it goes through the ordinary task PATCH, so every rule
 * a hand edit meets (dates in order, workspace scope) applies unchanged.
 *
 * "Applied" is derived, not remembered: when the task already holds the
 * proposed value the card says so, which is also what a replayed thread shows.
 */
export function ProposalCard({
  proposal,
  current,
  onApply,
}: {
  proposal: TaskProposal;
  /** Omitted where the task is not loaded; then only a fresh Apply shows as done. */
  current?: CurrentTaskValues;
  onApply: (proposal: TaskProposal) => Promise<boolean>;
}) {
  const [applying, setApplying] = useState(false);
  const [appliedHere, setAppliedHere] = useState(false);

  const currentValue = current?.[proposal.field];
  const known = current !== undefined && proposal.field in current;
  const matches =
    known &&
    currentValue !== undefined &&
    currentValue !== null &&
    String(currentValue).trim() === String(proposal.value).trim();
  const applied = appliedHere || matches;

  async function apply() {
    setApplying(true);
    const ok = await onApply(proposal);
    setApplying(false);
    if (ok) setAppliedHere(true);
  }

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs font-semibold tracking-wide text-violet-800 uppercase">
          Proposed {FIELD_LABEL[proposal.field].toLowerCase()}
        </span>
        {known && !applied ? (
          <span className="text-xs text-slate-500">
            now: {proposal.field === "description"
              ? currentValue
                ? "set"
                : "empty"
              : display(proposal.field, currentValue ?? null)}
          </span>
        ) : null}
        <span className="ml-auto">
          {applied ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
              <Check className="size-3.5" aria-hidden />
              Applied
            </span>
          ) : (
            <Button type="button" size="sm" onClick={() => void apply()} disabled={applying}>
              {applying ? <Spinner className="size-3.5 border-white/40 border-t-white" /> : null}
              Apply
            </Button>
          )}
        </span>
      </div>

      <div className="mt-2 text-slate-800">
        {proposal.field === "description" ? (
          <p className="whitespace-pre-wrap">{String(proposal.value)}</p>
        ) : proposal.field === "priority" ? (
          <span className="inline-flex items-center gap-1.5 font-medium capitalize">
            <Flag
              fill="currentColor"
              aria-hidden
              className={cn(
                "size-3.5",
                PRIORITY_FLAG[proposal.value as keyof typeof PRIORITY_FLAG],
              )}
            />
            {String(proposal.value)}
          </span>
        ) : (
          <span className="font-medium">{display(proposal.field, proposal.value)}</span>
        )}
      </div>

      {proposal.citations.length > 0 ? (
        <ul className="mt-2 space-y-1 border-t border-violet-200/70 pt-2 text-xs text-slate-600">
          {proposal.citations.map((citation) => (
            <li key={`${citation.label}-${citation.excerpt}`}>
              <span className="font-medium text-slate-500">[{citation.label}]</span>{" "}
              <span className="italic">“{citation.excerpt}”</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The PATCH body that applies one proposal to a task. */
export function proposalPatch(proposal: TaskProposal): Record<string, unknown> {
  // Only document passages can be stored as the task's Sources; a live record
  // citation (the task itself, a milestone) has no chunk behind it.
  const citations = proposal.citations
    .filter((citation) => citation.chunkId !== null)
    .map((citation) => ({ chunkId: citation.chunkId, quote: citation.excerpt }));
  return {
    [proposal.field]: proposal.value,
    ...(citations.length > 0 ? { citations } : {}),
  };
}
