"use client";

import { useEffect, useState } from "react";
import { Flag, Maximize2, Sparkles, UserRound, X } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  ErrorState,
  Input,
  QUIET_CONTROL,
  ROW_ICON,
  ROW_LABEL,
  Select,
  Spinner,
} from "@/components/ui";
import { proposalPatch } from "@/components/chat/proposal-card";
import { TaskChat } from "@/components/task-chat";
import { TaskComments } from "@/components/task-comments";
import { TaskDependencies } from "@/components/task-dependencies";
import { TaskDocumentsField } from "@/components/task-documents-field";
import { fillBlockedReason } from "@/components/task-fill-bar";
import { fillDraft, type FillSummary } from "@/components/task-fill-client";
import {
  draftFrom,
  linkedDocuments,
  toPartialPayload,
  type TaskDraft,
} from "@/components/task-form";
import {
  PRIORITY_FLAG,
  STATUS_DOT,
  TASK_PRIORITIES,
  isTaskOverdue,
  statusColorToken,
  type MemberOption,
  type MilestoneOption,
  type ProjectDocumentOption,
  type TaskPriority,
  type TaskRow,
  type TaskStatusOption,
} from "@/components/task-types";
import type { TaskProposal } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { TracedRequirements } from "@/components/traced-requirements";

/**
 * Slide-over for one task, and the place a task is edited.
 *
 * It used to be read-only apart from the status `<select>`, with a button that
 * closed the panel and reopened the record in a form — so changing a due date
 * meant leaving the thing you were looking at. Every field is now editable
 * here, and each edit saves itself: there is no Save button because there is
 * nothing to submit.
 *
 * **Each edit sends only the field that changed.** `updateTaskSchema` is built
 * with no `.default()` so a PATCH cannot resurrect fields the caller never
 * mentioned, and sending the whole draft would defeat that — two people editing
 * different fields of one task would each overwrite the other's with whatever
 * their panel happened to be showing.
 *
 * The panel is keyed on `task.id` by its parent, so opening a different task
 * remounts it and the draft starts from the right record. That is deliberately
 * not an effect syncing props into state.
 */
export function TaskDetail({
  task,
  allTasks,
  statuses,
  members,
  milestones,
  documents,
  currentUserId,
  busy,
  onClose,
  onExpand,
  onDocumentChange,
  onDelete,
  onTaskChange,
  onError,
}: {
  task: TaskRow;
  allTasks: TaskRow[];
  statuses: TaskStatusOption[];
  members: MemberOption[];
  milestones: MilestoneOption[];
  documents: ProjectDocumentOption[];
  currentUserId: string;
  busy: boolean;
  onClose: () => void;
  /**
   * Reopens the current edits in the full-width form — with a fill's report
   * when an AI fill produced them, so they are reviewed before they are saved.
   */
  onExpand: (draft: TaskDraft, fill?: FillSummary) => void;
  onDocumentChange: (document: ProjectDocumentOption) => void;
  onDelete: () => void;
  onTaskChange: (task: TaskRow) => void;
  onError: (message: string | null) => void;
}) {
  const [draft, setDraft] = useState<TaskDraft>(() => draftFrom(task));
  const [saving, setSaving] = useState(false);
  const [filling, setFilling] = useState(false);
  const [tab, setTab] = useState<"details" | "ai">("details");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Blurring first lets a field being typed in commit itself, since the
      // text fields save on blur and unmounting fires no blur event.
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const datesInverted =
    draft.startDate !== "" &&
    draft.dueDate !== "" &&
    draft.startDate > draft.dueDate;

  const disabled = busy || saving || filling;
  const linked = linkedDocuments(
    task.documents.map((link) => link.document.id),
    documents,
    task.documents,
  );
  const fillBlocked = fillBlockedReason(draft.title, linked);

  /**
   * Every other field here saves as it changes, but a fill must not: it would
   * write model output straight onto the task. It opens in the form instead,
   * blanks filled and sources quoted, and nothing is stored until Save.
   */
  async function fill() {
    setFilling(true);
    setError(null);
    try {
      const result = await fillDraft(task.projectId, draft, {
        // The panel cannot tell a chosen "medium" from the untouched default;
        // the form shows the result for review either way.
        priorityIsBlank: draft.priority === "medium",
        linkedRequirementIds: task.requirementLinks.map(
          (link) => link.requirement.id,
        ),
      });
      onExpand(result.draft, result.summary);
    } catch (caught) {
      setError((caught as Error).message);
      setFilling(false);
    }
  }

  /** Links and unlinks save at once, like the dependencies beside them. */
  async function changeDocuments(
    request: () => Promise<Response>,
    documentIds: string[],
  ) {
    setSaving(true);
    setError(null);
    try {
      const response = await request();
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Could not update the task's documents.");
        return;
      }
      // Kept in step with the server so "expand to form" cannot hand the form
      // a stale set that its Save would then write back.
      setDraft((current) => ({ ...current, documentIds }));
      onTaskChange(data.task);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Applies one field change and persists it.
   *
   * The draft moves first so the control does not visibly snap back to its old
   * value while the request is in flight, and is restored from the value the
   * panel had before the edit if the server refuses.
   */
  async function save(
    patch: Partial<TaskDraft>,
    extra: Record<string, unknown> = {},
  ): Promise<boolean> {
    const before = draft;
    setDraft({ ...draft, ...patch });
    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...toPartialPayload(patch), ...extra }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setDraft(before);
        setError(data.error ?? "Could not save that change.");
        return false;
      }
      onTaskChange(data.task);
      return true;
    } catch {
      setDraft(before);
      setError("Could not reach the server.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  /**
   * Applies a chat proposal as an ordinary edit of that one field, so the
   * field on the Details tab updates with it and every server rule a hand edit
   * meets (dates in order, workspace scope) applies. The passages it cited
   * travel along and become the task's Sources.
   */
  function applyProposal(proposal: TaskProposal): Promise<boolean> {
    const { citations } = proposalPatch(proposal);
    return save(
      { [proposal.field]: String(proposal.value) } as Partial<TaskDraft>,
      citations ? { citations } : {},
    );
  }

  /** Commits a text field on blur — saving per keystroke would be a request per
   *  character — and only when it actually differs from what is stored. */
  function commitText(field: "title" | "description", value: string) {
    const current = field === "title" ? task.title : (task.description ?? "");
    if (value === current) return;
    // A task must have a name, so an emptied title is treated as a cancelled
    // edit rather than a save the server would reject anyway.
    if (field === "title" && value.trim() === "") {
      setDraft({ ...draft, title: task.title });
      return;
    }
    void save({ [field]: value } as Partial<TaskDraft>);
  }

  const blockedBy = task.dependencies.filter(
    (dependency) => dependency.dependsOnTask.status.category !== "done",
  );

  const selectedStatus =
    statuses.find((status) => status.id === draft.statusId) ?? task.status;
  const statusTone = statusColorToken(selectedStatus);
  const assignee = members.find((member) => member.id === draft.assigneeId);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close task details"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/30"
      />

      <div
        role="dialog"
        aria-label={`Task: ${task.title}`}
        aria-modal="true"
        className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-slate-200 bg-white shadow-xl"
      >
        <div className="sticky top-0 z-10 flex flex-wrap items-start gap-2 border-b border-slate-200 bg-white/95 px-4 pt-4 backdrop-blur">
          {/* The name is edited in place at heading size, matching the create
              form — the title of the thing you are looking at, not a field. */}
          <Input
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            onBlur={(event) => commitText("title", event.target.value)}
            aria-label="Task name"
            maxLength={200}
            disabled={disabled}
            className="h-auto min-w-0 flex-1 border-transparent bg-transparent px-0 py-0 text-base font-semibold text-pretty text-slate-900 focus-visible:border-transparent disabled:bg-transparent"
          />

          {/* Expanding hands the *current* draft to the form, not the stored
              record, so an edit in flight survives the switch. */}
          <button
            type="button"
            onClick={() => onExpand(draft)}
            aria-label="Expand to form view"
            title="Expand to form view"
            className="shrink-0 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <Maximize2 className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="size-4" aria-hidden />
          </button>

          {/* A real tablist: both panels live in this component and swap in
              place, unlike the project tabs, which are separate routes. It
              wraps onto its own line inside the sticky header. */}
          <div role="tablist" aria-label="Task views" className="-ml-1 flex basis-full gap-1">
            {(
              [
                ["details", "Details"],
                ["ai", "Ask AI"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                id={`task-tab-${value}`}
                aria-selected={tab === value}
                aria-controls={`task-panel-${value}`}
                onClick={() => setTab(value)}
                className={cn(
                  "-mb-px inline-flex items-center gap-1.5 border-b-2 px-1.5 pt-1 pb-2 text-sm font-medium transition-colors",
                  tab === value
                    ? "border-slate-900 text-slate-900"
                    : "border-transparent text-slate-500 hover:text-slate-800",
                )}
              >
                {value === "ai" ? (
                  <Sparkles className="size-3.5 text-violet-600" aria-hidden />
                ) : null}
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Details stays mounted while hidden, so a half-typed edit survives a
            look at the chat. */}
        {tab === "ai" ? (
          <div
            role="tabpanel"
            id="task-panel-ai"
            aria-labelledby="task-tab-ai"
            className="flex flex-1 flex-col"
          >
            {error ? (
              <div className="px-4 pt-4">
                <ErrorState message={error} />
              </div>
            ) : null}
            <TaskChat
              taskId={task.id}
              linkedDocumentCount={task.documents.length}
              current={{
                description: task.description,
                priority: task.priority,
                estimatedHours: task.estimatedHours,
                startDate: task.startDate?.slice(0, 10) ?? null,
                dueDate: task.dueDate?.slice(0, 10) ?? null,
              }}
              onApply={applyProposal}
            />
          </div>
        ) : null}

        <div
          role="tabpanel"
          id="task-panel-details"
          aria-labelledby="task-tab-details"
          hidden={tab !== "details"}
          className="flex-1 space-y-5 p-4"
        >
          {error ? <ErrorState message={error} /> : null}

          {/* A narrower label column than the create modal's: the panel is
              448px wide, and 6rem of label left the two date inputs wrapping
              onto separate lines with the arrow orphaned between them. Same
              icon gutter as the create form so the controls share one edge. */}
          <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
            <label htmlFor="detail-status" className={ROW_LABEL}>
              Status
            </label>
            <div className="flex min-w-0 items-center gap-2">
              <span aria-hidden className={ROW_ICON}>
                <span
                  className={cn("size-2 rounded-full", STATUS_DOT[statusTone])}
                />
              </span>
              <Select
                id="detail-status"
                className={cn(QUIET_CONTROL, "font-medium")}
                value={draft.statusId}
                disabled={disabled}
                onChange={(event) =>
                  void save({ statusId: event.target.value })
                }
              >
                {statuses.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.label}
                  </option>
                ))}
              </Select>
            </div>

            <label htmlFor="detail-assignee" className={ROW_LABEL}>
              Assignee
            </label>
            <div className="flex min-w-0 items-center gap-2">
              {assignee ? (
                <Avatar name={assignee.name} email={assignee.email} />
              ) : (
                <span aria-hidden className={cn(ROW_ICON, "rounded-full bg-slate-100")}>
                  <UserRound className="size-3.5" />
                </span>
              )}
              <Select
                id="detail-assignee"
                className={QUIET_CONTROL}
                value={draft.assigneeId}
                disabled={disabled}
                onChange={(event) => void save({ assigneeId: event.target.value })}
              >
                <option value="">Unassigned</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </Select>
            </div>

            <label htmlFor="detail-priority" className={ROW_LABEL}>
              Priority
            </label>
            <div className="flex min-w-0 items-center gap-2">
              <span aria-hidden className={ROW_ICON}>
                <Flag
                  fill="currentColor"
                  className={cn("size-3.5", PRIORITY_FLAG[draft.priority])}
                />
              </span>
              <Select
                id="detail-priority"
                className={cn(QUIET_CONTROL, "capitalize")}
                value={draft.priority}
                disabled={disabled}
                onChange={(event) =>
                  void save({ priority: event.target.value as TaskPriority })
                }
              >
                {TASK_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority} className="capitalize">
                    {priority}
                  </option>
                ))}
              </Select>
            </div>

            <label htmlFor="detail-milestone" className={ROW_LABEL}>
              Milestone
            </label>
            <div className="flex min-w-0 items-center gap-2">
              <span aria-hidden className={ROW_ICON} />
              <Select
                id="detail-milestone"
                className={QUIET_CONTROL}
                value={draft.milestoneId}
                disabled={disabled}
                onChange={(event) => void save({ milestoneId: event.target.value })}
              >
                <option value="">None</option>
                {milestones.map((milestone) => (
                  <option key={milestone.id} value={milestone.id}>
                    {milestone.title}
                  </option>
                ))}
              </Select>
            </div>

            <label htmlFor="detail-start" className={ROW_LABEL}>
              Dates
            </label>
            <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1">
              <span aria-hidden className={ROW_ICON} />
              <Input
                id="detail-start"
                type="date"
                className={cn(QUIET_CONTROL, "max-w-none px-2")}
                value={draft.startDate}
                disabled={disabled}
                aria-label="Start date"
                aria-invalid={datesInverted || undefined}
                onChange={(event) =>
                  setDraft({ ...draft, startDate: event.target.value })
                }
                onBlur={(event) => {
                  if (event.target.value === (task.startDate?.slice(0, 10) ?? ""))
                    return;
                  void save({ startDate: event.target.value });
                }}
              />
              <span aria-hidden className="text-slate-300">
                →
              </span>
              <Input
                id="detail-due"
                type="date"
                className={cn(
                  QUIET_CONTROL,
                  "max-w-none px-2",
                  isTaskOverdue(task) &&
                    "bg-red-50 text-red-700 hover:bg-red-100/80 focus-visible:bg-red-50",
                )}
                value={draft.dueDate}
                disabled={disabled}
                aria-label="Due date"
                aria-invalid={datesInverted || undefined}
                onChange={(event) =>
                  setDraft({ ...draft, dueDate: event.target.value })
                }
                onBlur={(event) => {
                  if (event.target.value === (task.dueDate?.slice(0, 10) ?? ""))
                    return;
                  void save({ dueDate: event.target.value });
                }}
              />
              {isTaskOverdue(task) ? (
                <span className="text-xs font-medium text-red-700">overdue</span>
              ) : null}
            </div>

            <label htmlFor="detail-estimate" className={ROW_LABEL}>
              Estimate
            </label>
            <div className="flex items-center gap-1.5">
              <span aria-hidden className={ROW_ICON} />
              <Input
                id="detail-estimate"
                type="number"
                min={0}
                step="0.5"
                placeholder="0"
                className={cn(QUIET_CONTROL, "w-20 max-w-none")}
                value={draft.estimatedHours}
                disabled={disabled}
                onChange={(event) =>
                  setDraft({ ...draft, estimatedHours: event.target.value })
                }
                onBlur={(event) => {
                  const current =
                    task.estimatedHours === null ? "" : String(task.estimatedHours);
                  if (event.target.value === current) return;
                  void save({ estimatedHours: event.target.value });
                }}
              />
              <span className="text-xs text-slate-400">hours</span>
            </div>

            <span className={ROW_LABEL}>Origin</span>
            <div className="flex items-center gap-2">
              <span aria-hidden className={ROW_ICON} />
              <Badge tone={task.source === "manual" ? "neutral" : "info"}>
                {task.source === "manual" ? "Manual" : "AI suggested"}
              </Badge>
            </div>
          </div>

          {datesInverted ? (
            <p role="alert" className="text-xs font-medium text-red-700">
              Start date must be on or before the due date.
            </p>
          ) : null}

          <div>
            <label
              htmlFor="detail-description"
              className="mb-1.5 block text-xs font-medium text-slate-500"
            >
              Description
            </label>
            <textarea
              id="detail-description"
              value={draft.description}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
              onBlur={(event) => commitText("description", event.target.value)}
              placeholder="What does this task involve?"
              maxLength={4000}
              disabled={disabled}
              className={cn(
                "min-h-32 w-full rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm leading-relaxed text-slate-700",
                "placeholder:text-slate-400 hover:bg-slate-100",
                "focus-visible:border-slate-900 focus-visible:bg-white focus-visible:outline-hidden",
              )}
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void fill()}
              disabled={disabled || fillBlocked !== null}
            >
              {filling ? (
                <Spinner className="size-3.5" />
              ) : (
                <Sparkles className="size-3.5 text-violet-600" aria-hidden />
              )}
              {filling ? "Reading documents…" : "Fill blanks with AI"}
            </Button>
            <span className="text-xs text-slate-500">
              {fillBlocked ?? "Opens the result for review before anything is saved."}
            </span>
          </div>

          {task.status.category !== "done" && blockedBy.length > 0 ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Waiting on {blockedBy.length} unfinished task
              {blockedBy.length === 1 ? "" : "s"}.
            </p>
          ) : null}

          {/* Dependencies, citations, and comments are relationships rather than
              fields of this draft — each saves on its own. */}
          <div>
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Delivers
            </h3>
            <TracedRequirements
              projectId={task.projectId}
              links={task.requirementLinks}
              empty="No requirement links this task. Link it from the Requirements tab."
            />
          </div>

          <div>
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Documents
            </h3>
            <TaskDocumentsField
              projectId={task.projectId}
              linked={linked}
              available={documents}
              disabled={disabled}
              onAdd={(document) =>
                void changeDocuments(
                  () =>
                    fetch(`/api/tasks/${task.id}/documents`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ documentId: document.id }),
                    }),
                  [...draft.documentIds.filter((id) => id !== document.id), document.id],
                )
              }
              onRemove={(documentId) =>
                void changeDocuments(
                  () =>
                    fetch(`/api/tasks/${task.id}/documents/${documentId}`, {
                      method: "DELETE",
                    }),
                  draft.documentIds.filter((id) => id !== documentId),
                )
              }
              onDocumentChange={onDocumentChange}
            />
          </div>

          <div>
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Dependencies
            </h3>
            <TaskDependencies
              task={task}
              allTasks={allTasks}
              onChange={onTaskChange}
              onError={onError}
            />
          </div>

          {task.citations.length > 0 ? (
            <div>
              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Sources
              </h3>
              <ul className="space-y-2">
                {task.citations.map((citation) => (
                  <li
                    key={citation.id}
                    className="rounded-lg border border-slate-200 p-2.5 text-xs"
                  >
                    <a
                      href={`/documents/${citation.chunk.document.id}`}
                      className="font-medium text-slate-800 underline hover:text-slate-950"
                    >
                      {citation.chunk.document.originalFilename}
                      {citation.chunk.pageNumber
                        ? ` · p.${citation.chunk.pageNumber}`
                        : ""}
                      {citation.chunk.sectionTitle
                        ? ` · ${citation.chunk.sectionTitle}`
                        : ""}
                    </a>
                    {citation.purpose === "milestone_link" ? (
                      <Badge tone="info" className="ml-1.5">
                        Milestone link
                      </Badge>
                    ) : null}
                    {citation.excerpt ? (
                      <p className="mt-1 text-slate-600 italic">
                        “{citation.excerpt}”
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="border-t border-slate-100 pt-4">
            <TaskComments taskId={task.id} currentUserId={currentUserId} />
          </div>
        </div>

        <div
          hidden={tab !== "details"}
          className="sticky bottom-0 flex items-center gap-2 border-t border-slate-200 bg-white p-4"
        >
          {/* Saving is reported rather than commanded: there is no Save button
              because there is nothing to submit — each field commits itself. */}
          <span className="flex-1 text-xs text-slate-500">
            {saving ? (
              <span className="inline-flex items-center gap-1.5">
                <Spinner className="size-3" />
                Saving…
              </span>
            ) : (
              "Changes save as you make them."
            )}
          </span>
          <Button
            type="button"
            variant="secondary"
            className="border-red-200 text-red-700 hover:bg-red-50"
            onClick={onDelete}
            disabled={disabled}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
