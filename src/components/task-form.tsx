"use client";

import { useState } from "react";
import { Flag, UserRound } from "lucide-react";
import {
  Avatar,
  Button,
  Input,
  QUIET_CONTROL,
  ROW_ICON,
  ROW_LABEL,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { useT } from "@/components/i18n-provider";
import { Modal, ModalBody, ModalFooter } from "@/components/modal";
import { TaskDocumentsField } from "@/components/task-documents-field";
import { fillBlockedReason, TaskFillBar } from "@/components/task-fill-bar";
import { fillDraft, type FillSummary } from "@/components/task-fill-client";
import { displayStatusLabel } from "@/lib/i18n/status-labels";
import { cn } from "@/lib/utils";
import {
  PRIORITY_FLAG,
  STATUS_DOT,
  TASK_PRIORITIES,
  statusColorToken,
  toDateInput,
  type MemberOption,
  type MilestoneOption,
  type ProjectDocumentOption,
  type TaskPriority,
  type TaskRow,
  type TaskStatusOption,
} from "@/components/task-types";

export interface TaskDraft {
  title: string;
  description: string;
  statusId: string;
  priority: TaskPriority;
  assigneeId: string;
  milestoneId: string;
  estimatedHours: string;
  startDate: string;
  dueDate: string;
  /** Linked project documents; saved as a set. */
  documentIds: string[];
  /** Passages an AI fill drew on, saved as the task's Sources. */
  citations: Array<{ chunkId: string; quote: string }>;
  /** Requirement links an AI fill suggested; added on save. */
  requirementIds: string[];
}

/**
 * A new task starts assigned to the person creating it. Most tasks are
 * written down by the person who will do them, and an unassigned task in a
 * team workspace appears on nobody's Today.
 */
export function emptyDraft(statusId: string, assigneeId = ""): TaskDraft {
  return {
    title: "",
    description: "",
    statusId,
    priority: "medium",
    assigneeId,
    milestoneId: "",
    estimatedHours: "",
    startDate: "",
    dueDate: "",
    documentIds: [],
    citations: [],
    requirementIds: [],
  };
}

export function draftFrom(task: TaskRow): TaskDraft {
  return {
    title: task.title,
    description: task.description ?? "",
    statusId: task.statusId,
    priority: task.priority,
    assigneeId: task.assigneeId ?? "",
    milestoneId: task.milestoneId ?? "",
    estimatedHours:
      task.estimatedHours === null ? "" : String(task.estimatedHours),
    startDate: toDateInput(task.startDate),
    dueDate: toDateInput(task.dueDate),
    documentIds: task.documents.map((link) => link.document.id),
    citations: [],
    requirementIds: [],
  };
}

function toPayload(draft: TaskDraft) {
  return {
    title: draft.title.trim(),
    description: draft.description.trim() || null,
    statusId: draft.statusId,
    priority: draft.priority,
    assigneeId: draft.assigneeId || null,
    milestoneId: draft.milestoneId || null,
    estimatedHours: draft.estimatedHours === "" ? null : draft.estimatedHours,
    startDate: draft.startDate || null,
    dueDate: draft.dueDate || null,
    documentIds: draft.documentIds,
    // Add-only on the server, so an empty list is simply omitted.
    ...(draft.citations.length > 0 ? { citations: draft.citations } : {}),
    ...(draft.requirementIds.length > 0
      ? { requirementIds: draft.requirementIds }
      : {}),
  };
}

/**
 * The same field mapping as `toPayload`, but for a *partial* edit — one field
 * changed in the detail panel rather than a whole form submitted.
 *
 * It must stay partial. `updateTaskSchema` is built with no `.default()`
 * precisely so a PATCH cannot resurrect a field the caller never mentioned, and
 * sending the full draft for a single-field edit would throw that away: two
 * people editing different fields of the same task would each overwrite the
 * other's with whatever their panel happened to be showing.
 */
export function toPartialPayload(
  patch: Partial<TaskDraft>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (patch.title !== undefined) payload.title = patch.title.trim();
  if (patch.description !== undefined)
    payload.description = patch.description.trim() || null;
  if (patch.statusId !== undefined) payload.statusId = patch.statusId;
  if (patch.priority !== undefined) payload.priority = patch.priority;
  if (patch.assigneeId !== undefined)
    payload.assigneeId = patch.assigneeId || null;
  if (patch.milestoneId !== undefined)
    payload.milestoneId = patch.milestoneId || null;
  if (patch.startDate !== undefined) payload.startDate = patch.startDate || null;
  if (patch.dueDate !== undefined) payload.dueDate = patch.dueDate || null;
  if (patch.estimatedHours !== undefined)
    payload.estimatedHours =
      patch.estimatedHours === "" ? null : patch.estimatedHours;
  return payload;
}

/** Linked ids resolved to the board's current documents, which carry live status. */
export function linkedDocuments(
  documentIds: string[],
  documents: ProjectDocumentOption[],
  fallback: TaskRow["documents"] = [],
): ProjectDocumentOption[] {
  const byId = new Map(documents.map((document) => [document.id, document]));
  for (const link of fallback) {
    if (!byId.has(link.document.id)) byId.set(link.document.id, link.document);
  }
  return documentIds.flatMap((id) => {
    const document = byId.get(id);
    return document ? [document] : [];
  });
}

export function TaskForm({
  projectId,
  draft,
  statuses,
  members,
  milestones,
  documents,
  linkedRequirementIds = [],
  initialFill = null,
  saving,
  editing,
  timeline,
  onChange,
  onDocumentChange,
  onCancel,
  onSubmit,
}: {
  projectId: string;
  draft: TaskDraft;
  statuses: TaskStatusOption[];
  members: MemberOption[];
  milestones: MilestoneOption[];
  documents: ProjectDocumentOption[];
  /** Requirements an existing task already delivers, so a fill does not re-suggest them. */
  linkedRequirementIds?: string[];
  /** A fill already run by the detail panel, shown for review on open. */
  initialFill?: FillSummary | null;
  saving: boolean;
  editing: boolean;
  /** Whether the project draws a timeline (delivery tools on). */
  timeline: boolean;
  onChange: (draft: TaskDraft) => void;
  onDocumentChange: (document: ProjectDocumentOption) => void;
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  // Priority always holds a value, so "blank" for the fill means "still the
  // default nobody chose". Only this form knows whether it was touched.
  const [priorityTouched, setPriorityTouched] = useState(
    () => initialFill?.filled.includes("priority") ?? false,
  );
  // A start date only draws a bar on the timeline, which only delivery
  // projects have; elsewhere it is one more field to skip. A task that already
  // has one keeps it visible, so it can still be seen and cleared.
  const [hadStart] = useState(() => draft.startDate !== "");
  const showStart = timeline || hadStart || draft.startDate !== "";
  const [filling, setFilling] = useState(false);
  const [fillError, setFillError] = useState<string | null>(null);
  const [fillSummary, setFillSummary] = useState<FillSummary | null>(initialFill);
  const t = useT();

  async function runFill() {
    setFilling(true);
    setFillError(null);
    try {
      const result = await fillDraft(projectId, draft, {
        priorityIsBlank: !priorityTouched && draft.priority === "medium",
        linkedRequirementIds,
        t,
      });
      onChange(result.draft);
      setFillSummary(result.summary);
      if (result.summary.filled.includes("priority")) setPriorityTouched(true);
    } catch (error) {
      setFillError((error as Error).message);
    } finally {
      setFilling(false);
    }
  }

  const busy = saving || filling;
  const linked = linkedDocuments(draft.documentIds, documents);

  // Mirrors the server rule so the problem is visible before a round trip; the
  // API rejects it independently.
  const datesInverted =
    draft.startDate !== "" &&
    draft.dueDate !== "" &&
    draft.startDate > draft.dueDate;

  const submittable = draft.title.trim() !== "" && !busy && !datesInverted;

  const selectedStatus = statuses.find((status) => status.id === draft.statusId);
  const statusTone = selectedStatus
    ? statusColorToken(selectedStatus)
    : "slate";
  const assignee = members.find((member) => member.id === draft.assigneeId);

  return (
    <Modal
      title={editing ? t("tasks.form.editTitle") : t("tasks.form.newTitle")}
      // No subtitle: the fields below already carry their own defaults and
      // placeholders, and a line of explanation above them was one more thing
      // to read before starting to type.
      onClose={busy ? () => {} : onCancel}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!submittable) return;
          onSubmit(toPayload(draft));
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <ModalBody>
          {/* The task's name is the heading of the thing being edited, not one
              more labelled field among seven, so it is typed at heading size
              with no box around it. */}
          <Input
            id="task-title"
            value={draft.title}
            onChange={(event) => onChange({ ...draft, title: event.target.value })}
            placeholder={t("tasks.fields.name")}
            aria-label={t("tasks.fields.name")}
            maxLength={200}
            disabled={busy}
            required
            // Not React's `autoFocus` — see the note in `Modal`.
            data-autofocus
            // The focus ring is deliberately *not* removed with the border: it
            // is the app's one focus treatment, and a borderless field with no
            // ring gives a keyboard user nothing to locate.
            className="h-auto border-transparent bg-transparent px-0 py-1 text-2xl font-semibold tracking-tight text-sand-900 placeholder:font-medium placeholder:text-sand-400 focus-visible:border-transparent disabled:bg-transparent"
          />

          <div className="mt-2">
            <TaskFillBar
              blockedReason={fillBlockedReason(draft.title, linked, t)}
              filling={filling}
              error={fillError}
              summary={fillSummary}
              hasLinkedDocuments={draft.documentIds.length > 0}
              disabled={busy}
              onFill={() => void runFill()}
              onRemoveRequirement={(requirementId) => {
                onChange({
                  ...draft,
                  requirementIds: draft.requirementIds.filter(
                    (id) => id !== requirementId,
                  ),
                });
                setFillSummary((summary) =>
                  summary
                    ? {
                        ...summary,
                        requirements: summary.requirements.filter(
                          (requirement) => requirement.id !== requirementId,
                        ),
                      }
                    : summary,
                );
              }}
            />
          </div>

          {/* A plain grid, not the `<dl>` the record lists use: these are form
              controls, and wrapping them in a description list makes a screen
              reader announce a six-item list around fields whose own labels
              already say everything. Every value cell starts with the same
              `ROW_ICON` gutter so the controls share one left edge — without
              it the status dot, priority flag, and assignee avatar each pushed
              the text to a different x. Colour lives on those icons, not on
              soft fills behind the selects: two coloured pills next to each
              other compete for one glance. */}
          <div className="mt-3 grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
            <label htmlFor="task-assignee" className={ROW_LABEL}>
              {t("tasks.fields.assignee")}
            </label>
            <div className="flex min-w-0 items-center gap-2">
              {assignee ? (
                <Avatar name={assignee.name} email={assignee.email} />
              ) : (
                <span aria-hidden className={cn(ROW_ICON, "rounded-full bg-sand-100")}>
                  <UserRound className="size-3.5" />
                </span>
              )}
              <Select
                id="task-assignee"
                className={QUIET_CONTROL}
                value={draft.assigneeId}
                onChange={(event) =>
                  onChange({ ...draft, assigneeId: event.target.value })
                }
                disabled={busy}
              >
                <option value="">{t("common.unassigned")}</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </Select>
            </div>

            <label htmlFor="task-status" className={ROW_LABEL}>
              {t("tasks.fields.status")}
            </label>
            <div className="flex min-w-0 items-center gap-2">
              <span aria-hidden className={ROW_ICON}>
                <span
                  className={cn("size-2 rounded-full", STATUS_DOT[statusTone])}
                />
              </span>
              <Select
                id="task-status"
                className={cn(QUIET_CONTROL, "font-medium")}
                value={draft.statusId}
                onChange={(event) =>
                  onChange({ ...draft, statusId: event.target.value })
                }
                disabled={busy}
              >
                {statuses.map((status) => (
                  <option key={status.id} value={status.id}>
                    {displayStatusLabel(status, t)}
                  </option>
                ))}
              </Select>
            </div>

            <label htmlFor="task-priority" className={ROW_LABEL}>
              {t("tasks.fields.priority")}
            </label>
            <div className="flex min-w-0 items-center gap-2">
              <span aria-hidden className={ROW_ICON}>
                <Flag
                  fill="currentColor"
                  className={cn("size-3.5", PRIORITY_FLAG[draft.priority])}
                />
              </span>
              <Select
                id="task-priority"
                className={QUIET_CONTROL}
                value={draft.priority}
                onChange={(event) => {
                  setPriorityTouched(true);
                  onChange({
                    ...draft,
                    priority: event.target.value as TaskPriority,
                  });
                }}
                disabled={busy}
              >
                {TASK_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {t(`priority.${priority}`)}
                  </option>
                ))}
              </Select>
            </div>

            <label htmlFor="task-milestone" className={ROW_LABEL}>
              {t("tasks.fields.milestone")}
            </label>
            <div className="flex min-w-0 items-center gap-2">
              <span aria-hidden className={ROW_ICON} />
              <Select
                id="task-milestone"
                className={QUIET_CONTROL}
                value={draft.milestoneId}
                onChange={(event) =>
                  onChange({ ...draft, milestoneId: event.target.value })
                }
                disabled={busy}
              >
                <option value="">{t("common.none")}</option>
                {milestones.map((milestone) => (
                  <option key={milestone.id} value={milestone.id}>
                    {milestone.title}
                  </option>
                ))}
              </Select>
            </div>

            {showStart ? (
              <>
                <label htmlFor="task-start" className={ROW_LABEL}>
                  {t("tasks.fields.startDate")}
                </label>
                <div className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className={ROW_ICON} />
                  <Input
                    id="task-start"
                    type="date"
                    className={QUIET_CONTROL}
                    value={draft.startDate}
                    onChange={(event) =>
                      onChange({ ...draft, startDate: event.target.value })
                    }
                    disabled={busy}
                    aria-invalid={datesInverted || undefined}
                    aria-describedby={datesInverted ? "task-date-error" : undefined}
                  />
                </div>
              </>
            ) : null}

            <label htmlFor="task-due" className={ROW_LABEL}>
              {t("tasks.fields.dueDate")}
            </label>
            <div className="flex min-w-0 items-center gap-2">
              <span aria-hidden className={ROW_ICON} />
              <Input
                id="task-due"
                type="date"
                className={QUIET_CONTROL}
                value={draft.dueDate}
                onChange={(event) =>
                  onChange({ ...draft, dueDate: event.target.value })
                }
                disabled={busy}
                aria-invalid={datesInverted || undefined}
                aria-describedby={datesInverted ? "task-date-error" : undefined}
              />
            </div>

            <label htmlFor="task-estimate" className={ROW_LABEL}>
              {t("tasks.fields.estimate")}
            </label>
            <div className="flex items-center gap-1.5">
              <span aria-hidden className={ROW_ICON} />
              <Input
                id="task-estimate"
                type="number"
                min={0}
                step="0.5"
                // "0" rather than a dash: an empty number field is still null,
                // and a dash placeholder reads as a value already set.
                placeholder="0"
                className={cn(QUIET_CONTROL, "w-20 max-w-none")}
                value={draft.estimatedHours}
                onChange={(event) =>
                  onChange({ ...draft, estimatedHours: event.target.value })
                }
                disabled={busy}
              />
              <span className="text-xs text-sand-400">{t("tasks.fields.hours")}</span>
            </div>

            {/* Starts at the top rather than centred: the value grows a line
                per linked document. */}
            <span className={cn(ROW_LABEL, "self-start pt-2")}>
              {t("tasks.fields.documents")}
            </span>
            <div className="min-w-0 py-1">
              <TaskDocumentsField
                projectId={projectId}
                linked={linked}
                available={documents}
                disabled={busy}
                onAdd={(document) =>
                  onChange({
                    ...draft,
                    documentIds: draft.documentIds.includes(document.id)
                      ? draft.documentIds
                      : [...draft.documentIds, document.id],
                  })
                }
                onRemove={(documentId) =>
                  onChange({
                    ...draft,
                    documentIds: draft.documentIds.filter((id) => id !== documentId),
                  })
                }
                onDocumentChange={onDocumentChange}
              />
            </div>
          </div>

          {datesInverted ? (
            <p
              id="task-date-error"
              role="alert"
              className="mt-2 text-xs font-medium text-red-700"
            >
              {t("tasks.fields.datesInverted")}
            </p>
          ) : timeline && (draft.startDate || draft.dueDate) ? (
            // Only once a date exists. Explaining how dates draw on the
            // timeline to someone who has not entered one is a line of text
            // earning nothing.
            <p className="mt-2 text-xs text-sand-500">{t("tasks.form.timelineHint")}</p>
          ) : null}

          {/* The one field that needs room to think in, so it gets the space
              the seven boxed inputs above it used to take. */}
          <div className="mt-5">
            <label
              htmlFor="task-description"
              className="mb-1.5 block text-xs font-medium text-sand-500"
            >
              {t("tasks.fields.description")}
            </label>
            <Textarea
              id="task-description"
              value={draft.description}
              onChange={(event) =>
                onChange({ ...draft, description: event.target.value })
              }
              placeholder={t("tasks.fields.descriptionPlaceholder")}
              maxLength={4000}
              disabled={busy}
              className="min-h-56 resize-y leading-relaxed"
            />
          </div>
        </ModalBody>

        <ModalFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={busy}
          >
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={!submittable}>
            {saving ? (
              <>
                <Spinner className="border-white/40 border-t-white" />
                {t("common.saving")}
              </>
            ) : editing ? (
              t("tasks.form.saveChanges")
            ) : (
              t("tasks.form.create")
            )}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
