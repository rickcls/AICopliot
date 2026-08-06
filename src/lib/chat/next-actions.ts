import type { Citation } from "@/lib/schemas";

/**
 * An answer's own citations decide where it lets you go next.
 *
 * Deterministic and pure: no model call, no extra query, and nothing to persist
 * — a replayed turn derives the same links from the same stored citations. A
 * refusal produces none, because a refusal carries no citations by construction.
 */

export interface NextAction {
  label: string;
  href: string;
}

/** More than four stops being a next step and becomes a toolbar. */
const MAX_ACTIONS = 4;

const PROJECT_ACTION_LABELS = {
  task: "Open in Tasks",
  // A dependency lives on the board, so it collapses into the task link.
  dependency: "Open in Tasks",
  milestone: "Open the timeline",
  risk: "Open the risk register",
  // Deliberately the register, not the record: /projects/[id]/requirements has
  // no per-record anchor yet, so "View REQ-007" would land you at the top of the
  // list having promised otherwise.
  requirement: "Open the requirements register",
  project_snapshot: "Open the project overview",
} as const;

export function nextActionsFor(citations: Citation[]): NextAction[] {
  const byHref = new Map<string, NextAction>();

  for (const citation of citations) {
    const action: NextAction =
      citation.kind === "document"
        ? {
            label: `Open ${citation.filename}`,
            href: `/documents/${citation.documentId}`,
          }
        : {
            label: PROJECT_ACTION_LABELS[citation.kind],
            // Already constrained to an in-app path by projectCitationSchema, so
            // a model-influenced value can never become an off-site URL.
            href: citation.href,
          };

    // First-seen order wins: citation order is the model's, roughly relevance.
    if (!byHref.has(action.href)) byHref.set(action.href, action);
  }

  return [...byHref.values()].slice(0, MAX_ACTIONS);
}
