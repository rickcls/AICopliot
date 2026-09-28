import { resolveDocumentCitations } from "@/lib/grounding/document-citations";
import { MAX_FILL_REQUIREMENTS, type ModelTaskFill } from "./schemas";
import type { ValidatedProposalCitation } from "./validate";

/**
 * Anything a label can resolve to that has text to check against: a document
 * chunk for the task fill, and a chunk or a live record for task chat.
 */
type CheckableSourceMap = Map<string, { id: string; content: string }>;

export type TaskFillField =
  | "description"
  | "priority"
  | "estimatedHours"
  | "startDate"
  | "dueDate";

export interface FilledValue<T> {
  value: T;
  citations: ValidatedProposalCitation[];
}

export interface ValidatedTaskFill {
  description: FilledValue<string> | null;
  priority: FilledValue<"low" | "medium" | "high" | "urgent"> | null;
  estimatedHours: FilledValue<number> | null;
  startDate: FilledValue<string> | null;
  dueDate: FilledValue<string> | null;
  /** Real requirement ids, resolved from the Q labels the model returned. */
  requirementIds: string[];
  /** Fields the model proposed that a rule then removed, for the UI to explain. */
  dropped: TaskFillField[];
}

/** `Q3` → the requirement id the server put behind that label. */
export type RequirementLabelMap = Map<string, string>;

function cite<T>(
  field: { value: T; citations: Array<{ sourceId: string; quote: string }> } | null,
  sourceMap: CheckableSourceMap,
): FilledValue<T> | null {
  if (!field) return null;
  const { citations } = resolveDocumentCitations(field.citations, sourceMap);
  // Invariant 3 applied per field: a value with no surviving source is a guess.
  return citations.length > 0 ? { value: field.value, citations } : null;
}

function citedContent(
  filled: FilledValue<unknown>,
  sourceMap: CheckableSourceMap,
): string {
  return filled.citations
    .map((citation) => sourceMap.get(citation.sourceId)?.content ?? "")
    .join("\n");
}

/**
 * A date is kept only if a cited source contains both its year and its day of
 * the month as numbers. This is the deterministic backstop for the prompt's
 * "stated dates only" rule: "two weeks after kickoff" or "end of Q4" can make a
 * model produce a confident calendar date, and neither contains one.
 */
export function sourceStatesDate(content: string, isoDay: string): boolean {
  const [year, , day] = isoDay.split("-");
  const dayNumber = Number(day);
  const hasYear = new RegExp(`(^|\\D)${year}(\\D|$)`).test(content);
  const hasDay = new RegExp(`(^|\\D)0?${dayNumber}(st|nd|rd|th)?(\\D|$)`, "i").test(
    content,
  );
  return hasYear && hasDay;
}

/**
 * An estimate is kept only if a cited source contains the number of hours, or
 * the number of days it converts from at eight hours a day — the one
 * conversion the prompt allows.
 */
export function sourceStatesEffort(content: string, hours: number): boolean {
  const candidates = [hours, hours / 8].filter(
    (value) => Number.isFinite(value) && value > 0,
  );
  return candidates.some((value) => {
    const text = String(Number(value.toFixed(2)));
    return new RegExp(`(^|[^\\d.])${text.replace(".", "\\.")}([^\\d]|$)`).test(
      content,
    );
  });
}

/**
 * Turns a model's fill into values safe to put in front of the user.
 *
 * Nothing here is written to the database: the result goes into the task form,
 * where only blank fields take it and nothing saves until the user does.
 */
export function validateTaskFill(
  model: ModelTaskFill,
  sourceMap: CheckableSourceMap,
  requirementLabels: RequirementLabelMap,
): ValidatedTaskFill {
  const dropped: TaskFillField[] = [];
  const keep = <T>(
    name: TaskFillField,
    proposed: unknown,
    filled: FilledValue<T> | null,
  ) => {
    if (proposed && !filled) dropped.push(name);
    return filled;
  };

  const description = keep(
    "description",
    model.description,
    cite(
      model.description
        ? { value: model.description.text, citations: model.description.citations }
        : null,
      sourceMap,
    ),
  );
  const priority = keep("priority", model.priority, cite(model.priority, sourceMap));

  let estimatedHours = cite(model.estimatedHours, sourceMap);
  if (
    estimatedHours &&
    !sourceStatesEffort(citedContent(estimatedHours, sourceMap), estimatedHours.value)
  ) {
    estimatedHours = null;
  }
  estimatedHours = keep("estimatedHours", model.estimatedHours, estimatedHours);

  const datedOrNull = (filled: FilledValue<string> | null) =>
    filled && sourceStatesDate(citedContent(filled, sourceMap), filled.value)
      ? filled
      : null;
  let startDate = keep(
    "startDate",
    model.startDate,
    datedOrNull(cite(model.startDate, sourceMap)),
  );
  const dueDate = keep(
    "dueDate",
    model.dueDate,
    datedOrNull(cite(model.dueDate, sourceMap)),
  );
  // A bar cannot end before it begins. The deadline is the more commonly
  // stated of the two, so the start gives way.
  if (startDate && dueDate && startDate.value > dueDate.value) {
    dropped.push("startDate");
    startDate = null;
  }

  const requirementIds: string[] = [];
  for (const label of model.requirements) {
    const id = requirementLabels.get(label.trim().toUpperCase());
    if (!id || requirementIds.includes(id)) continue;
    requirementIds.push(id);
    if (requirementIds.length >= MAX_FILL_REQUIREMENTS) break;
  }

  return {
    description,
    priority,
    estimatedHours,
    startDate,
    dueDate,
    requirementIds,
    dropped,
  };
}
