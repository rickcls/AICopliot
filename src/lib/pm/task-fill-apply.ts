import type {
  TaskFillResult,
  TaskFillSource,
} from "@/lib/generation/task-fill-service";
import type { TaskFillField } from "@/lib/generation/task-fill-validate";

export type { TaskFillResult, TaskFillSource, TaskFillField };

/** The slice of a task form a fill can write to. Form values are strings. */
export interface FillableDraft {
  description: string;
  priority: "low" | "medium" | "high" | "urgent";
  estimatedHours: string;
  startDate: string;
  dueDate: string;
  documentIds: string[];
  citations: Array<{ chunkId: string; quote: string }>;
  requirementIds: string[];
}

export interface AppliedFill<T extends FillableDraft> {
  draft: T;
  /** Fields that were blank and now hold the proposal. */
  filled: TaskFillField[];
  /** Fields the model proposed but the user had already set, left untouched. */
  kept: TaskFillField[];
  /** Requirements newly added to the draft. */
  requirements: TaskFillResult["fill"]["requirements"];
  /** Sources backing the fields actually filled — the ones worth showing. */
  sources: TaskFillSource[];
}

/**
 * Writes a fill into the form's *blank* fields and nothing else.
 *
 * "Blank" is literal for text, numbers, and dates. Priority always holds a
 * value, so it counts as blank only while it is still the untouched default —
 * the caller says so, because only the form knows whether a person chose
 * "medium" or merely left it there.
 *
 * Cited documents join the draft's linked documents, and the passages behind
 * each filled field become citations, so a saved task keeps its sources.
 * Suggested requirements are added, never replacing ones already linked.
 */
export function applyTaskFill<T extends FillableDraft>(
  draft: T,
  result: TaskFillResult,
  options: { priorityIsBlank: boolean; linkedRequirementIds?: readonly string[] },
): AppliedFill<T> {
  const next: T = { ...draft };
  const filled: TaskFillField[] = [];
  const kept: TaskFillField[] = [];
  const { fill } = result;

  const offer = (field: TaskFillField, blank: boolean, write: () => void) => {
    if (blank) {
      write();
      filled.push(field);
    } else {
      kept.push(field);
    }
  };

  if (fill.description !== null) {
    offer("description", draft.description.trim() === "", () => {
      next.description = fill.description!;
    });
  }
  if (fill.priority !== null) {
    offer("priority", options.priorityIsBlank, () => {
      next.priority = fill.priority!;
    });
  }
  if (fill.estimatedHours !== null) {
    offer("estimatedHours", draft.estimatedHours.trim() === "", () => {
      next.estimatedHours = String(fill.estimatedHours);
    });
  }
  // A proposed date that would invert the span the user already set is held
  // back rather than written into a form that then refuses to submit.
  if (fill.startDate !== null) {
    const fits = draft.dueDate === "" || fill.startDate <= draft.dueDate;
    offer("startDate", draft.startDate === "" && fits, () => {
      next.startDate = fill.startDate!;
    });
  }
  if (fill.dueDate !== null) {
    const fits = next.startDate === "" || next.startDate <= fill.dueDate;
    offer("dueDate", draft.dueDate === "" && fits, () => {
      next.dueDate = fill.dueDate!;
    });
  }

  const alreadyLinked = new Set([
    ...draft.requirementIds,
    ...(options.linkedRequirementIds ?? []),
  ]);
  const requirements = fill.requirements.filter(
    (requirement) => !alreadyLinked.has(requirement.id),
  );
  next.requirementIds = [
    ...draft.requirementIds,
    ...requirements.map((requirement) => requirement.id),
  ];

  const sources = result.sources.filter((source) =>
    source.fields.some((field) => filled.includes(field)),
  );
  const citedChunks = new Set(draft.citations.map((citation) => citation.chunkId));
  next.citations = [
    ...draft.citations,
    ...sources
      .filter((source) => !citedChunks.has(source.chunkId))
      .map((source) => ({ chunkId: source.chunkId, quote: source.excerpt })),
  ];
  const linkedDocuments = new Set(draft.documentIds);
  next.documentIds = [
    ...draft.documentIds,
    ...[...new Set(sources.map((source) => source.documentId))].filter(
      (documentId) => !linkedDocuments.has(documentId),
    ),
  ];

  return { draft: next, filled, kept, requirements, sources };
}

const FIELD_LABELS: Record<TaskFillField, string> = {
  description: "description",
  priority: "priority",
  estimatedHours: "estimate",
  startDate: "start date",
  dueDate: "due date",
};

export function fillFieldLabel(field: TaskFillField): string {
  return FIELD_LABELS[field];
}
