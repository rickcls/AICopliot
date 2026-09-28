import {
  applyTaskFill,
  type FillableDraft,
  type TaskFillField,
  type TaskFillResult,
  type TaskFillSource,
} from "@/lib/pm/task-fill-apply";

/** What the form shows after a fill: what changed, what was left, and why. */
export interface FillSummary {
  filled: TaskFillField[];
  kept: TaskFillField[];
  dropped: TaskFillField[];
  requirements: TaskFillResult["fill"]["requirements"];
  sources: TaskFillSource[];
  evidence: TaskFillResult["evidence"];
}

/**
 * Asks the server for a grounded fill and writes it into the draft's blank
 * fields. Throws with the server's own wording, which already says what to do
 * next ("link or upload a document that describes it").
 */
export async function fillDraft<T extends FillableDraft & { title: string }>(
  projectId: string,
  draft: T,
  options: { priorityIsBlank: boolean; linkedRequirementIds?: readonly string[] },
): Promise<{ draft: T; summary: FillSummary }> {
  let response: Response;
  try {
    response = await fetch(`/api/projects/${projectId}/task-fill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: draft.title,
        description: draft.description || undefined,
        documentIds: draft.documentIds,
      }),
    });
  } catch {
    throw new Error("Could not reach the server.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error ?? "Could not fill in the task.");
  }

  const result = data as TaskFillResult;
  const applied = applyTaskFill(draft, result, options);
  return {
    draft: applied.draft,
    summary: {
      filled: applied.filled,
      kept: applied.kept,
      dropped: result.dropped,
      requirements: applied.requirements,
      sources: applied.sources,
      evidence: result.evidence,
    },
  };
}
