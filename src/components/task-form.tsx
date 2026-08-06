"use client";

import { Button, Input, Select, Spinner, Textarea } from "@/components/ui";
import { Modal, ModalBody, ModalFooter } from "@/components/modal";
import { cn } from "@/lib/utils";
import {
  TASK_PRIORITIES,
  toDateInput,
  type MemberOption,
  type MilestoneOption,
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
}

export function emptyDraft(statusId: string): TaskDraft {
  return {
    title: "",
    description: "",
    statusId,
    priority: "medium",
    assigneeId: "",
    milestoneId: "",
    estimatedHours: "",
    startDate: "",
    dueDate: "",
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

/**
 * Metadata reads as quiet label/value rows rather than a grid of boxed inputs.
 *
 * Every control used to carry a permanent border and white fill, so a form with
 * seven of them read as seven competing objects and the description — the only
 * field that needs room to think in — was the smallest thing on screen. Here the
 * chrome only appears on hover and focus, so at rest the block reads as a short
 * list of facts, and the description gets the space.
 */
export const QUIET_CONTROL =
  "w-full max-w-sm border-transparent bg-transparent hover:bg-slate-100 focus-visible:border-slate-900 focus-visible:bg-white disabled:bg-transparent";

export const ROW_LABEL = "text-xs font-medium text-slate-500";

export function TaskForm({
  draft,
  statuses,
  members,
  milestones,
  saving,
  editing,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: TaskDraft;
  statuses: TaskStatusOption[];
  members: MemberOption[];
  milestones: MilestoneOption[];
  saving: boolean;
  editing: boolean;
  onChange: (draft: TaskDraft) => void;
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  // Mirrors the server rule so the problem is visible before a round trip; the
  // API rejects it independently.
  const datesInverted =
    draft.startDate !== "" &&
    draft.dueDate !== "" &&
    draft.startDate > draft.dueDate;

  const submittable = draft.title.trim() !== "" && !saving && !datesInverted;

  return (
    <Modal
      title={editing ? "Edit task" : "New task"}
      // No subtitle: the fields below already carry their own defaults and
      // placeholders, and a line of explanation above them was one more thing
      // to read before starting to type.
      onClose={saving ? () => {} : onCancel}
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
            placeholder="Task name"
            aria-label="Task name"
            maxLength={200}
            disabled={saving}
            required
            // Not React's `autoFocus` — see the note in `Modal`.
            data-autofocus
            // The focus ring is deliberately *not* removed with the border: it
            // is the app's one focus treatment, and a borderless field with no
            // ring gives a keyboard user nothing to locate.
            className="h-auto border-transparent bg-transparent px-0 py-1 text-xl font-semibold text-slate-900 placeholder:text-slate-300 focus-visible:border-transparent disabled:bg-transparent"
          />

          {/* A plain grid, not the `<dl>` the record lists use: these are form
              controls, and wrapping them in a description list makes a screen
              reader announce a six-item list around fields whose own labels
              already say everything. */}
          <div className="mt-3 grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5">
            <label htmlFor="task-assignee" className={ROW_LABEL}>
              Assignee
            </label>
            <div>
              <Select
                id="task-assignee"
                className={QUIET_CONTROL}
                value={draft.assigneeId}
                onChange={(event) =>
                  onChange({ ...draft, assigneeId: event.target.value })
                }
                disabled={saving}
              >
                <option value="">Unassigned</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </Select>
            </div>

            <label htmlFor="task-status" className={ROW_LABEL}>
              Status
            </label>
            <div>
              <Select
                id="task-status"
                className={QUIET_CONTROL}
                value={draft.statusId}
                onChange={(event) =>
                  onChange({ ...draft, statusId: event.target.value })
                }
                disabled={saving}
              >
                {statuses.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.label}
                  </option>
                ))}
              </Select>
            </div>

            <label htmlFor="task-priority" className={ROW_LABEL}>
              Priority
            </label>
            <div>
              <Select
                id="task-priority"
                className={cn(QUIET_CONTROL, "capitalize")}
                value={draft.priority}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    priority: event.target.value as TaskPriority,
                  })
                }
                disabled={saving}
              >
                {TASK_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority} className="capitalize">
                    {priority}
                  </option>
                ))}
              </Select>
            </div>

            <label htmlFor="task-milestone" className={ROW_LABEL}>
              Milestone
            </label>
            <div>
              <Select
                id="task-milestone"
                className={QUIET_CONTROL}
                value={draft.milestoneId}
                onChange={(event) =>
                  onChange({ ...draft, milestoneId: event.target.value })
                }
                disabled={saving}
              >
                <option value="">None</option>
                {milestones.map((milestone) => (
                  <option key={milestone.id} value={milestone.id}>
                    {milestone.title}
                  </option>
                ))}
              </Select>
            </div>

            {/* Start and due share one row: they are one span, and splitting
                them cost a whole row to say so twice. */}
            <label htmlFor="task-start" className={ROW_LABEL}>
              Dates
            </label>
            <div className="flex flex-wrap items-center gap-1">
              <Input
                id="task-start"
                type="date"
                className={cn(QUIET_CONTROL, "w-auto max-w-none")}
                value={draft.startDate}
                onChange={(event) =>
                  onChange({ ...draft, startDate: event.target.value })
                }
                disabled={saving}
                aria-label="Start date"
                aria-invalid={datesInverted || undefined}
                aria-describedby={datesInverted ? "task-date-error" : undefined}
              />
              <span aria-hidden className="text-slate-300">
                →
              </span>
              <Input
                id="task-due"
                type="date"
                className={cn(QUIET_CONTROL, "w-auto max-w-none")}
                value={draft.dueDate}
                onChange={(event) =>
                  onChange({ ...draft, dueDate: event.target.value })
                }
                disabled={saving}
                aria-label="Due date"
                aria-invalid={datesInverted || undefined}
                aria-describedby={datesInverted ? "task-date-error" : undefined}
              />
            </div>

            <label htmlFor="task-estimate" className={ROW_LABEL}>
              Estimate
            </label>
            <div className="flex items-center gap-1.5">
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
                disabled={saving}
              />
              <span className="text-xs text-slate-400">hours</span>
            </div>
          </div>

          {datesInverted ? (
            <p
              id="task-date-error"
              role="alert"
              className="mt-2 text-xs font-medium text-red-700"
            >
              Start date must be on or before the due date.
            </p>
          ) : draft.startDate || draft.dueDate ? (
            // Only once a date exists. Explaining how dates draw on the
            // timeline to someone who has not entered one is a line of text
            // earning nothing.
            <p className="mt-2 text-xs text-slate-500">
              A start and due date together draw a bar on the timeline; a due
              date alone shows as a single marker.
            </p>
          ) : null}

          {/* The one field that needs room to think in, so it gets the space
              the seven boxed inputs above it used to take. */}
          <div className="mt-5">
            <label
              htmlFor="task-description"
              className="mb-1.5 block text-xs font-medium text-slate-500"
            >
              Description
            </label>
            <Textarea
              id="task-description"
              value={draft.description}
              onChange={(event) =>
                onChange({ ...draft, description: event.target.value })
              }
              placeholder="What does this task involve?"
              maxLength={4000}
              disabled={saving}
              className="min-h-56 resize-y leading-relaxed"
            />
          </div>
        </ModalBody>

        <ModalFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!submittable}>
            {saving ? (
              <>
                <Spinner className="border-white/40 border-t-white" />
                Saving…
              </>
            ) : editing ? (
              "Save changes"
            ) : (
              "Create task"
            )}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
