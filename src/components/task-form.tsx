"use client";

import { Button, Card, Input, Select, Spinner, Textarea } from "@/components/ui";
import {
  BOARD_COLUMNS,
  TASK_PRIORITIES,
  toDateInput,
  type MemberOption,
  type MilestoneOption,
  type TaskPriority,
  type TaskRow,
  type TaskStatus,
} from "@/components/task-types";

export interface TaskDraft {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string;
  milestoneId: string;
  estimatedHours: string;
  startDate: string;
  dueDate: string;
}

export function emptyDraft(status: TaskStatus = "backlog"): TaskDraft {
  return {
    title: "",
    description: "",
    status,
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
    status: task.status,
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
    status: draft.status,
    priority: draft.priority,
    assigneeId: draft.assigneeId || null,
    milestoneId: draft.milestoneId || null,
    estimatedHours: draft.estimatedHours === "" ? null : draft.estimatedHours,
    startDate: draft.startDate || null,
    dueDate: draft.dueDate || null,
  };
}

const fieldLabel = "mb-1 block text-xs font-medium text-slate-600";

export function TaskForm({
  draft,
  members,
  milestones,
  saving,
  editing,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: TaskDraft;
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

  return (
    <Card className="p-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.title.trim() || saving || datesInverted) return;
          onSubmit(toPayload(draft));
        }}
        className="space-y-3"
      >
        <p className="text-sm font-semibold">
          {editing ? "Edit task" : "New task"}
        </p>

        <div>
          <label htmlFor="task-title" className={fieldLabel}>
            Title
          </label>
          <Input
            id="task-title"
            value={draft.title}
            onChange={(event) => onChange({ ...draft, title: event.target.value })}
            placeholder="e.g. Validate failover runbook against staging"
            maxLength={200}
            disabled={saving}
            autoFocus
          />
        </div>

        <div>
          <label htmlFor="task-description" className={fieldLabel}>
            Description <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <Textarea
            id="task-description"
            value={draft.description}
            onChange={(event) =>
              onChange({ ...draft, description: event.target.value })
            }
            rows={2}
            maxLength={4000}
            disabled={saving}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
          <div>
            <label htmlFor="task-status" className={fieldLabel}>
              Status
            </label>
            <Select
              id="task-status"
              className="w-full"
              value={draft.status}
              onChange={(event) =>
                onChange({ ...draft, status: event.target.value as TaskStatus })
              }
              disabled={saving}
            >
              {BOARD_COLUMNS.map((column) => (
                <option key={column.status} value={column.status}>
                  {column.label}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label htmlFor="task-priority" className={fieldLabel}>
              Priority
            </label>
            <Select
              id="task-priority"
              className="w-full"
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
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label htmlFor="task-assignee" className={fieldLabel}>
              Assignee
            </label>
            <Select
              id="task-assignee"
              className="w-full"
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

          <div>
            <label htmlFor="task-milestone" className={fieldLabel}>
              Milestone
            </label>
            <Select
              id="task-milestone"
              className="w-full"
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

          <div>
            <label htmlFor="task-start" className={fieldLabel}>
              Start
            </label>
            <Input
              id="task-start"
              type="date"
              value={draft.startDate}
              onChange={(event) =>
                onChange({ ...draft, startDate: event.target.value })
              }
              disabled={saving}
            />
          </div>

          <div>
            <label htmlFor="task-due" className={fieldLabel}>
              Due
            </label>
            <Input
              id="task-due"
              type="date"
              value={draft.dueDate}
              onChange={(event) =>
                onChange({ ...draft, dueDate: event.target.value })
              }
              disabled={saving}
            />
          </div>

          <div>
            <label htmlFor="task-estimate" className={fieldLabel}>
              Estimate (h)
            </label>
            <Input
              id="task-estimate"
              type="number"
              min={0}
              step="0.5"
              value={draft.estimatedHours}
              onChange={(event) =>
                onChange({ ...draft, estimatedHours: event.target.value })
              }
              disabled={saving}
            />
          </div>
        </div>

        {datesInverted ? (
          <p role="alert" className="text-xs font-medium text-red-700">
            Start date must be on or before the due date.
          </p>
        ) : (
          <p className="text-xs text-slate-500">
            A start and due date together draw a bar on the timeline; a due date
            alone shows as a single marker.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={saving || !draft.title.trim() || datesInverted}
          >
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
        </div>
      </form>
    </Card>
  );
}
