import type { TaskPriority, TaskStatusCategory } from "@/generated/prisma/enums";
import { resolveDateExpression } from "@/lib/capture/dates";
import { citedNeighbourhood, type CaptureLine } from "@/lib/capture/lines";
import { modelProposalSchema, type ModelProposal } from "@/lib/capture/schemas";
import { requirementTitleKey } from "@/lib/generation/requirements-validate";
import { sourceStatesEffort } from "@/lib/generation/task-fill-validate";
import { toTraditional } from "@/lib/language-convert";
import type { ReplyLanguage } from "@/lib/language";

/**
 * The deterministic gate between what the model proposed and what the person
 * is shown. Nothing here trusts the model:
 *
 * - every proposal must cite at least one real capture line (C label), or it
 *   is dropped — the same rule as every other generated record;
 * - tasks and projects are named by opaque T/P labels and resolved through
 *   server maps; an unknown label is dropped, never guessed;
 * - a due date is recomputed by code from the phrase the model quoted, and the
 *   phrase must actually appear in the cited lines (invariant: dates are
 *   resolved by code, not by the model);
 * - an estimate survives only if the cited text states that number.
 *
 * Prose is converted to Traditional characters last, after every check that
 * compares against the source, and quoted text is never converted.
 */

export const MAX_CAPTURE_PROPOSALS = 20;

export type ProposalStatus = Extract<TaskStatusCategory, "done" | "blocked" | "open">;
export type ProposalFlag = "possible_duplicate" | "date_check";

export interface CitedLine {
  label: string;
  text: string;
}

export interface CreateTaskPayload {
  title: string;
  description: string | null;
  projectId: string | null;
  priority: TaskPriority | null;
  /** Set only when the cited lines say the work is waiting. */
  status: "blocked" | null;
  dueDate: string | null;
  duePhrase: string | null;
  estimatedHours: number | null;
}

export interface UpdateTaskPayload {
  status: ProposalStatus | null;
  priority: TaskPriority | null;
  dueDate: string | null;
  duePhrase: string | null;
}

export interface AddNotePayload {
  note: string;
}

interface ValidatedBase {
  citations: CitedLine[];
  flags: ProposalFlag[];
}

export type ValidatedProposal =
  | (ValidatedBase & { kind: "create_task"; taskId: null; payload: CreateTaskPayload })
  | (ValidatedBase & { kind: "update_task"; taskId: string; payload: UpdateTaskPayload })
  | (ValidatedBase & { kind: "add_note"; taskId: string; payload: AddNotePayload });

export interface CandidateRef {
  id: string;
  title: string;
  category: TaskStatusCategory;
  /** YYYY-MM-DD or null. */
  dueDate: string | null;
  priority: TaskPriority;
}

export interface CaptureValidationContext {
  lines: CaptureLine[];
  /** T label → task. */
  tasks: ReadonlyMap<string, CandidateRef>;
  /** P label → project id. */
  projects: ReadonlyMap<string, string>;
  /** The capture's local date, YYYY-MM-DD. */
  anchor: string;
  language: ReplyLanguage;
}

export type DropReason =
  | "malformed"
  | "uncited"
  | "unknown_task"
  | "noop"
  | "over_limit";

function compact(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

/**
 * Looser than the register's `requirementTitleKey`, on purpose: spacing is
 * dropped too, because "提交 月報" and "提交月報" are the same words. That is
 * safe here because a match only flags a proposal — it never drops one.
 */
function duplicateKey(title: string): string {
  return requirementTitleKey(title).replace(/\s+/g, "");
}

function prose(text: string, language: ReplyLanguage): string {
  return language === "zh-Hant" ? toTraditional(text) : text;
}

/**
 * The waiting phrases rule 8 of the prompt treats as blocked. The model's
 * status is kept only when one of them is actually in the cited lines.
 */
const WAITING = /等緊|卡住|未有回覆|\bwaiting for\b|\bblocked\b|\bon hold\b/i;

function citedStatesWaiting(text: string): boolean {
  return WAITING.test(text);
}

/**
 * A due date the person actually stated, resolved by code — or null. The model's
 * own date is used only to notice a disagreement, which is flagged so the
 * person sees the date before applying.
 */
type ModelDue = Extract<ModelProposal, { kind: "create_task" }>["due"];

function checkDue(
  due: ModelDue,
  citationLabels: string[],
  ctx: CaptureValidationContext,
  flags: Set<ProposalFlag>,
): { dueDate: string | null; duePhrase: string | null } {
  if (!due) return { dueDate: null, duePhrase: null };
  const near = compact(citedNeighbourhood(ctx.lines, citationLabels));
  if (!near.includes(compact(due.phrase))) return { dueDate: null, duePhrase: null };

  const resolved = resolveDateExpression(due.phrase, ctx.anchor);
  if (!resolved) return { dueDate: null, duePhrase: null };
  if (resolved !== due.date) flags.add("date_check");
  return { dueDate: resolved, duePhrase: due.phrase };
}

export function validateCaptureProposals(
  raw: readonly unknown[],
  ctx: CaptureValidationContext,
): {
  proposals: ValidatedProposal[];
  dropped: { index: number; reason: DropReason }[];
} {
  const lineByLabel = new Map(ctx.lines.map((line) => [line.label, line]));
  const openTitleKeys = new Set(
    [...ctx.tasks.values()].map((task) => duplicateKey(task.title)),
  );

  const proposals: ValidatedProposal[] = [];
  const dropped: { index: number; reason: DropReason }[] = [];

  raw.forEach((item, index) => {
    if (proposals.length >= MAX_CAPTURE_PROPOSALS) {
      dropped.push({ index, reason: "over_limit" });
      return;
    }
    const parsed = modelProposalSchema.safeParse(item);
    if (!parsed.success) {
      dropped.push({ index, reason: "malformed" });
      return;
    }
    const proposal = parsed.data;

    const labels = [...new Set(proposal.citations)].filter((label) => lineByLabel.has(label));
    if (labels.length === 0) {
      dropped.push({ index, reason: "uncited" });
      return;
    }
    const citations = labels.map((label) => ({
      label,
      text: lineByLabel.get(label)!.text,
    }));
    const citedText = citations.map((citation) => citation.text).join("\n");
    const flags = new Set<ProposalFlag>();

    if (proposal.kind === "create_task") {
      const { dueDate, duePhrase } = checkDue(proposal.due, labels, ctx, flags);
      const title = proposal.title.slice(0, 200);
      if (openTitleKeys.has(duplicateKey(title))) flags.add("possible_duplicate");
      const estimate =
        proposal.estimatedHours !== null &&
        sourceStatesEffort(citedText, proposal.estimatedHours)
          ? proposal.estimatedHours
          : null;

      proposals.push({
        kind: "create_task",
        taskId: null,
        citations,
        flags: [...flags],
        payload: {
          title: prose(title, ctx.language),
          description: proposal.description ? prose(proposal.description, ctx.language) : null,
          projectId: proposal.project ? (ctx.projects.get(proposal.project) ?? null) : null,
          priority: proposal.priority,
          status: proposal.status === "blocked" && citedStatesWaiting(citedText) ? "blocked" : null,
          dueDate,
          duePhrase,
          estimatedHours: estimate,
        },
      });
      return;
    }

    const task = ctx.tasks.get(proposal.task);
    if (!task) {
      dropped.push({ index, reason: "unknown_task" });
      return;
    }

    if (proposal.kind === "add_note") {
      proposals.push({
        kind: "add_note",
        taskId: task.id,
        citations,
        flags: [],
        payload: { note: prose(proposal.note, ctx.language) },
      });
      return;
    }

    const { dueDate, duePhrase } = checkDue(proposal.due, labels, ctx, flags);
    // Only real changes survive: "done" for a task already done, or the due
    // date it already has, would be an Apply button that does nothing.
    const status = proposal.status && proposal.status !== task.category ? proposal.status : null;
    const priority = proposal.priority && proposal.priority !== task.priority ? proposal.priority : null;
    const changedDue = dueDate && dueDate !== task.dueDate ? dueDate : null;
    if (!status && !priority && !changedDue) {
      dropped.push({ index, reason: "noop" });
      return;
    }

    proposals.push({
      kind: "update_task",
      taskId: task.id,
      citations,
      flags: changedDue ? [...flags] : [],
      payload: {
        status,
        priority,
        dueDate: changedDue,
        duePhrase: changedDue ? duePhrase : null,
      },
    });
  });

  return { proposals, dropped };
}
