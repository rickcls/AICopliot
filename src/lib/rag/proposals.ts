import { modelTaskFillSchema } from "@/lib/generation/schemas";
import { validateTaskFill } from "@/lib/generation/task-fill-validate";
import type { ModelAnswer, TaskProposal } from "@/lib/schemas";
import type { SourceMap } from "./prompt";

/**
 * Turns the edits a task-focused answer proposed into ones safe to offer.
 *
 * Deliberately the task fill's validator, not a second one: a proposal from
 * chat and a value from "Fill blanks with AI" land in the same task fields, so
 * they must clear the same bar — a citation per field that resolves to a
 * supplied source, and dates and effort that the cited text actually states.
 * The first proposal for a field wins; the model repeating a field is noise.
 *
 * Pure, like the citation validator beside it.
 */
export function validateProposals(
  proposals: ModelAnswer["proposals"],
  sourceMap: SourceMap,
): TaskProposal[] {
  const first = new Map<string, ModelAnswer["proposals"][number]>();
  for (const proposal of proposals) {
    if (!first.has(proposal.field)) first.set(proposal.field, proposal);
  }
  const field = (name: string) => {
    const proposal = first.get(name);
    return proposal ? { value: proposal.value, citations: proposal.citations } : null;
  };
  const description = first.get("description");

  // Parsed rather than built by hand, so a wrong-typed value (a priority of
  // "critical", a date of "30/10/2026") fails alone exactly as in the fill.
  const fill = modelTaskFillSchema.parse({
    description: description
      ? { text: String(description.value), citations: description.citations }
      : null,
    priority: field("priority"),
    estimatedHours: field("estimatedHours"),
    startDate: field("startDate"),
    dueDate: field("dueDate"),
    requirements: [],
  });
  const validated = validateTaskFill(fill, sourceMap, new Map());

  const out: TaskProposal[] = [];
  const push = (
    name: TaskProposal["field"],
    filled: { value: string | number; citations: Array<{ sourceId: string; chunkId: string; excerpt: string }> } | null,
  ) => {
    if (!filled) return;
    out.push({
      field: name,
      value: filled.value,
      citations: filled.citations.map((citation) => {
        const source = sourceMap.get(citation.sourceId);
        // Only a document chunk can become a TaskCitation when applied; a live
        // record is shown as a source but has no chunk to store.
        const isRecord = source !== undefined && "kind" in source;
        return {
          label: citation.sourceId,
          kind: isRecord ? ("record" as const) : ("document" as const),
          chunkId: isRecord ? null : citation.chunkId,
          excerpt: citation.excerpt,
        };
      }),
    });
  };
  push("description", validated.description);
  push("priority", validated.priority);
  push("estimatedHours", validated.estimatedHours);
  push("startDate", validated.startDate);
  push("dueDate", validated.dueDate);
  return out;
}
