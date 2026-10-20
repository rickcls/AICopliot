import type { Translate } from "@/lib/i18n/translate";
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

// Labels live under `chat.next`. A dependency lives on the board, so it reads
// as the task link; a requirement opens the register rather than the record,
// because "View REQ-007" would promise an anchor the link does not reach.

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function nextActionsFor(citations: Citation[], t: Translate): NextAction[] {
  const byHref = new Map<string, NextAction>();

  for (const citation of citations) {
    const action: NextAction =
      citation.kind === "document"
        ? {
            label: t("chat.next.openDocument", { filename: citation.filename }),
            href: `/documents/${citation.documentId}`,
          }
        : {
            // A task link opens that task, so it is named — several cited
            // tasks would otherwise be several identical "Open in Tasks".
            label:
              citation.kind === "task"
                ? t("chat.next.openTask", { title: truncate(citation.title, 40) })
                : t(`chat.next.${citation.kind}`),
            // Already constrained to an in-app path by projectCitationSchema, so
            // a model-influenced value can never become an off-site URL.
            href: citation.href,
          };

    // First-seen order wins: citation order is the model's, roughly relevance.
    if (!byHref.has(action.href)) byHref.set(action.href, action);
  }

  return [...byHref.values()].slice(0, MAX_ACTIONS);
}
