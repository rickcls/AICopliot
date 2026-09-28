"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CHECKBOX,
  DescriptionList,
  EmptyState,
  ErrorState,
  Field,
  FOCUS_RING,
  Input,
  LinkButton,
  SectionHeader,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { Check, ChevronRight, X } from "lucide-react";
import { useConfirm } from "@/components/confirm-dialog";
import { worstRiskLevel } from "@/lib/pm/filters";
import { cn, formatDate, formatDay } from "@/lib/utils";

type GenerationStatus = "draft" | "approved" | "rejected" | "not_applicable";
type ItemKind = "milestone" | "task" | "risk" | "dependency";

interface ReadyDocument {
  id: string;
  originalFilename: string;
  chunkCount: number;
}

interface EvidenceCitation {
  id: string;
  excerpt: string | null;
  purpose?: "proposal" | "milestone_link";
  chunk: {
    id: string;
    pageNumber: number | null;
    sectionTitle: string | null;
    document: { id: string; originalFilename: string };
  };
}

interface ReviewMilestone {
  id: string;
  title: string;
  description: string | null;
  targetDate: string | null;
  status: "not_started" | "on_track" | "at_risk" | "blocked" | "completed";
  generationStatus: GenerationStatus;
  reviewedAt: string | null;
  citations: EvidenceCitation[];
}

interface ReviewTask {
  id: string;
  title: string;
  description: string | null;
  status: "backlog" | "todo" | "in_progress" | "blocked" | "done";
  priority: "low" | "medium" | "high" | "urgent";
  startDate: string | null;
  dueDate: string | null;
  generationStatus: GenerationStatus;
  reviewedAt: string | null;
  milestone: {
    id: string;
    title: string;
    generationStatus: GenerationStatus;
  } | null;
  citations: EvidenceCitation[];
}

interface ReviewRisk {
  id: string;
  description: string;
  impact: "low" | "medium" | "high";
  likelihood: "low" | "medium" | "high";
  mitigation: string | null;
  status: "open" | "monitoring" | "mitigated" | "accepted";
  generationStatus: GenerationStatus;
  reviewedAt: string | null;
  milestone: {
    id: string;
    title: string;
    generationStatus: GenerationStatus;
  } | null;
  citations: EvidenceCitation[];
}

interface ReviewDependency {
  id: string;
  taskId: string;
  dependsOnTaskId: string;
  generationStatus: GenerationStatus;
  reviewedAt: string | null;
  task: { id: string; title: string; generationStatus: GenerationStatus };
  dependsOnTask: {
    id: string;
    title: string;
    generationStatus: GenerationStatus;
  };
  citations: EvidenceCitation[];
}

interface SummaryCitation {
  sourceId: string;
  excerpt: string;
}

interface ValidatedPlanSummary {
  scopeStatements?: Array<{ text: string; citations: SummaryCitation[] }>;
  deliverables?: Array<{ text: string; citations: SummaryCitation[] }>;
  acceptanceCriteria?: Array<{ text: string; citations: SummaryCitation[] }>;
  warnings?: string[];
  sourceLabels?: Array<{
    label: string;
    filename: string;
    pageNumber: number | null;
    sectionTitle: string | null;
  }>;
}

export interface ReviewRunView {
  id: string;
  model: string;
  promptVersion: string;
  status:
    | "processing"
    | "draft"
    | "approved"
    | "partially_approved"
    | "rejected"
    | "failed";
  errorMessage: string | null;
  latencyMs: number | null;
  validatedOutput: ValidatedPlanSummary | null;
  createdAt: string;
  approvedAt: string | null;
  milestones: ReviewMilestone[];
  tasks: ReviewTask[];
  risks: ReviewRisk[];
  taskDependencies: ReviewDependency[];
}

type Proposal =
  | ({ kind: "milestone" } & ReviewMilestone)
  | ({ kind: "task" } & ReviewTask)
  | ({ kind: "risk" } & ReviewRisk)
  | ({ kind: "dependency" } & ReviewDependency);

const RUN_TONE = {
  processing: "warning",
  draft: "info",
  approved: "success",
  partially_approved: "warning",
  rejected: "neutral",
  failed: "danger",
} as const;

function day(value: string | null) {
  return value ? value.slice(0, 10) : "";
}

function itemKey(item: { kind: ItemKind; id: string }) {
  return `${item.kind}:${item.id}`;
}

function CitationList({ citations }: { citations: EvidenceCitation[] }) {
  if (citations.length === 0) return null;
  return (
    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
      {citations.map((citation) => (
        <div key={citation.id} className="rounded-lg bg-slate-50 px-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <Link
              href={`/documents/${citation.chunk.document.id}`}
              className="font-medium text-slate-700 hover:underline"
            >
              {citation.chunk.document.originalFilename}
            </Link>
            {citation.chunk.pageNumber !== null ? (
              <span>· page {citation.chunk.pageNumber}</span>
            ) : null}
            {citation.chunk.sectionTitle ? (
              <span>· {citation.chunk.sectionTitle}</span>
            ) : null}
            {citation.purpose === "milestone_link" ? (
              <Badge tone="info">Milestone link</Badge>
            ) : null}
          </div>
          {citation.excerpt ? (
            <p className="mt-1 text-xs leading-5 text-slate-600">
              “{citation.excerpt}”
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function SummarySection({
  title,
  rows,
  locations,
}: {
  title: string;
  rows: Array<{ text: string; citations: SummaryCitation[] }>;
  locations: Map<
    string,
    { filename: string; pageNumber: number | null; sectionTitle: string | null }
  >;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {title}
      </h3>
      <ul className="mt-2 space-y-2">
        {rows.map((row, index) => (
          <li key={`${title}-${index}`} className="rounded-lg bg-slate-50 p-3">
            <p className="text-sm text-slate-800">{row.text}</p>
            <div className="mt-2 space-y-1.5">
              {row.citations.map((citation) => {
                const location = locations.get(citation.sourceId);
                return (
                  <div
                    key={`${citation.sourceId}-${citation.excerpt}`}
                    className="rounded-md border border-blue-100 bg-white px-2.5 py-2"
                  >
                    <p className="text-xs font-medium text-blue-700">
                      {citation.sourceId}
                      {location ? ` · ${location.filename}` : ""}
                      {location?.pageNumber !== null &&
                      location?.pageNumber !== undefined
                        ? ` · page ${location.pageNumber}`
                        : ""}
                      {location?.sectionTitle
                        ? ` · ${location.sectionTitle}`
                        : ""}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      “{citation.excerpt}”
                    </p>
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const LEVEL_TONE = { low: "neutral", medium: "warning", high: "danger" } as const;

const TASK_STATUSES = ["backlog", "todo", "in_progress", "blocked", "done"];
const TASK_PRIORITY_VALUES = ["low", "medium", "high", "urgent"];
const MILESTONE_STATUSES = [
  "not_started",
  "on_track",
  "at_risk",
  "blocked",
  "completed",
];
const RISK_STATUSES = ["open", "monitoring", "mitigated", "accepted"];
const RISK_LEVELS = ["low", "medium", "high"];

function words(value: string) {
  return value.replaceAll("_", " ");
}

function initialValues(proposal: Proposal): Record<string, string> {
  if (proposal.kind === "milestone") {
    return {
      title: proposal.title,
      description: proposal.description ?? "",
      targetDate: day(proposal.targetDate),
      status: proposal.status,
    };
  }
  if (proposal.kind === "task") {
    return {
      title: proposal.title,
      description: proposal.description ?? "",
      startDate: day(proposal.startDate),
      dueDate: day(proposal.dueDate),
      status: proposal.status,
      priority: proposal.priority,
      milestoneId: proposal.milestone?.id ?? "",
    };
  }
  if (proposal.kind === "risk") {
    return {
      description: proposal.description,
      mitigation: proposal.mitigation ?? "",
      impact: proposal.impact,
      likelihood: proposal.likelihood,
      status: proposal.status,
      milestoneId: proposal.milestone?.id ?? "",
    };
  }
  return {
    taskId: proposal.taskId,
    dependsOnTaskId: proposal.dependsOnTaskId,
  };
}

/** The one line a collapsed row shows: what the proposal *is*. */
function headline(proposal: Proposal): string {
  if (proposal.kind === "risk") return proposal.description;
  if (proposal.kind === "dependency") {
    return `${proposal.task.title} → after ${proposal.dependsOnTask.title}`;
  }
  return proposal.title;
}

/**
 * Label + control on one row. Plain `div`s rather than the record lists'
 * `<dl>`: these are form controls with their own labels (see task-form.tsx).
 */
function EditRow({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center sm:gap-x-6">
      <label htmlFor={htmlFor} className="text-xs font-medium text-slate-500">
        {label}
      </label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * One proposal as one line, expanded on demand.
 *
 * This was a card per proposal with every field rendered as a live input, so a
 * 30-item plan was a wall of identical boxes and the thing a reviewer needs —
 * what is being proposed, and on what evidence — was the smallest text on
 * screen. Collapsed, a row carries only the title and the facts that decide
 * approval; the editor and the sources live in the expansion. Decided rows
 * expand into read-only values, not disabled inputs.
 */
function ProposalRow({
  proposal,
  tasks,
  milestones,
  selected,
  disabled,
  onToggle,
  onApprove,
  onSave,
  onReject,
}: {
  proposal: Proposal;
  tasks: ReviewTask[];
  milestones: ReviewMilestone[];
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
  onApprove: () => Promise<void>;
  onSave: (changes: Record<string, unknown>) => Promise<void>;
  onReject: () => Promise<void>;
}) {
  const editable = proposal.generationStatus === "draft";
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() =>
    initialValues(proposal),
  );
  const baseline = useMemo(() => initialValues(proposal), [proposal]);
  const dirty = Object.keys(values).some((key) => values[key] !== baseline[key]);
  const idPrefix = `proposal-${proposal.kind}-${proposal.id}`;

  function set(name: string, value: string) {
    setValues((previous) => ({ ...previous, [name]: value }));
  }

  const taskOptions = editable
    ? tasks.filter((task) => task.generationStatus !== "rejected")
    : tasks;
  const milestoneOptions = editable
    ? milestones.filter((milestone) => {
        if (milestone.generationStatus === "rejected") return false;
        if (proposal.kind !== "task" && proposal.kind !== "risk") return true;
        if (proposal.milestone?.id === milestone.id) return true;
        const linkChunkIds = new Set(
          proposal.citations
            .filter((citation) => citation.purpose === "milestone_link")
            .map((citation) => citation.chunk.id),
        );
        return milestone.citations.some((citation) =>
          linkChunkIds.has(citation.chunk.id),
        );
      })
    : milestones;

  async function save() {
    if (proposal.kind === "milestone") {
      await onSave({
        title: values.title,
        description: values.description || null,
        targetDate: values.targetDate || null,
        status: values.status,
      });
    } else if (proposal.kind === "task") {
      await onSave({
        title: values.title,
        description: values.description || null,
        startDate: values.startDate || null,
        dueDate: values.dueDate || null,
        status: values.status,
        priority: values.priority,
        milestoneId: values.milestoneId || null,
      });
    } else if (proposal.kind === "risk") {
      await onSave({
        description: values.description,
        mitigation: values.mitigation || null,
        impact: values.impact,
        likelihood: values.likelihood,
        status: values.status,
        milestoneId: values.milestoneId || null,
      });
    } else {
      await onSave({
        taskId: values.taskId,
        dependsOnTaskId: values.dependsOnTaskId,
      });
    }
  }

  const dateText =
    proposal.kind === "task"
      ? proposal.dueDate
        ? `due ${formatDay(proposal.dueDate)}`
        : null
      : proposal.kind === "milestone"
        ? proposal.targetDate
          ? formatDay(proposal.targetDate)
          : "no date"
        : null;

  function select(
    name: string,
    label: string,
    options: string[],
    format: (value: string) => string = words,
  ) {
    return (
      <EditRow label={label} htmlFor={`${idPrefix}-${name}`}>
        <Select
          id={`${idPrefix}-${name}`}
          value={values[name]}
          onChange={(event) => set(name, event.target.value)}
          disabled={disabled}
          className="h-9 w-full max-w-sm capitalize"
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {format(option)}
            </option>
          ))}
        </Select>
      </EditRow>
    );
  }

  function milestoneSelect() {
    return (
      <EditRow label="Milestone" htmlFor={`${idPrefix}-milestone`}>
        <Select
          id={`${idPrefix}-milestone`}
          value={values.milestoneId}
          onChange={(event) => set("milestoneId", event.target.value)}
          disabled={disabled}
          className="h-9 w-full max-w-sm"
        >
          <option value="">No milestone</option>
          {milestoneOptions.map((milestone) => (
            <option key={milestone.id} value={milestone.id}>
              {milestone.title}
            </option>
          ))}
        </Select>
      </EditRow>
    );
  }

  return (
    <li className={cn(disabled && "opacity-70")}>
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 transition-colors",
          open ? "bg-slate-50" : "hover:bg-slate-50/70",
        )}
      >
        {editable ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            disabled={disabled}
            aria-label={`Select “${headline(proposal)}”`}
            className={CHECKBOX}
          />
        ) : null}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className={cn(
            "flex min-w-0 flex-1 basis-60 items-center gap-2 rounded-md py-0.5 text-left",
            FOCUS_RING,
          )}
        >
          <ChevronRight
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-slate-400 transition-transform",
              open && "rotate-90",
            )}
          />
          <span className="min-w-0 truncate text-sm text-slate-900">
            {headline(proposal)}
          </span>
        </button>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5 pl-6 sm:pl-0">
          {proposal.kind === "risk" ? (
            <Badge tone={LEVEL_TONE[worstRiskLevel(proposal)]}>
              {proposal.impact} · {proposal.likelihood}
            </Badge>
          ) : null}
          {proposal.kind === "task" && proposal.priority === "urgent" ? (
            <Badge tone="danger">urgent</Badge>
          ) : null}
          {dateText ? (
            <span className="text-xs text-slate-500 tabular-nums">{dateText}</span>
          ) : null}
          {/* A proposal with no evidence cannot exist (validation drops it),
              so the count is information, never a warning. */}
          <span className="text-xs text-slate-400">
            {proposal.citations.length} source
            {proposal.citations.length === 1 ? "" : "s"}
          </span>
          {!editable ? (
            <Badge
              tone={proposal.generationStatus === "approved" ? "success" : "neutral"}
            >
              {words(proposal.generationStatus)}
            </Badge>
          ) : (
            <>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={disabled}
                aria-label={`Approve “${headline(proposal)}”`}
                title="Approve"
                onClick={() => void onApprove()}
                className="text-emerald-700 hover:bg-emerald-50"
              >
                <Check className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={disabled}
                aria-label={`Reject “${headline(proposal)}”`}
                title="Reject"
                onClick={() => void onReject()}
                className="text-slate-500 hover:bg-red-50 hover:text-red-700"
              >
                <X className="size-4" aria-hidden />
              </Button>
            </>
          )}
        </div>
      </div>

      {open ? (
        <div className="space-y-3 border-t border-slate-100 bg-slate-50/40 px-4 py-4 sm:pl-12">
          {editable ? (
            <div className="space-y-2.5">
              {proposal.kind === "milestone" || proposal.kind === "task" ? (
                <EditRow label="Title" htmlFor={`${idPrefix}-title`}>
                  <Input
                    id={`${idPrefix}-title`}
                    value={values.title}
                    onChange={(event) => set("title", event.target.value)}
                    disabled={disabled}
                    maxLength={200}
                    className="h-9"
                  />
                </EditRow>
              ) : null}

              {proposal.kind === "dependency" ? (
                <>
                  <EditRow label="Task" htmlFor={`${idPrefix}-task`}>
                    <Select
                      id={`${idPrefix}-task`}
                      value={values.taskId}
                      onChange={(event) => set("taskId", event.target.value)}
                      disabled={disabled}
                      className="h-9 w-full"
                    >
                      {taskOptions.map((task) => (
                        <option key={task.id} value={task.id}>
                          {task.title}
                        </option>
                      ))}
                    </Select>
                  </EditRow>
                  <EditRow label="Depends on" htmlFor={`${idPrefix}-prereq`}>
                    <Select
                      id={`${idPrefix}-prereq`}
                      value={values.dependsOnTaskId}
                      onChange={(event) =>
                        set("dependsOnTaskId", event.target.value)
                      }
                      disabled={disabled}
                      className="h-9 w-full"
                    >
                      {taskOptions.map((task) => (
                        <option key={task.id} value={task.id}>
                          {task.title}
                        </option>
                      ))}
                    </Select>
                  </EditRow>
                </>
              ) : (
                <EditRow
                  label={proposal.kind === "risk" ? "Risk" : "Description"}
                  htmlFor={`${idPrefix}-description`}
                >
                  <Textarea
                    id={`${idPrefix}-description`}
                    value={values.description}
                    onChange={(event) => set("description", event.target.value)}
                    disabled={disabled}
                    rows={2}
                    maxLength={4000}
                  />
                </EditRow>
              )}

              {proposal.kind === "milestone" ? (
                <>
                  <EditRow label="Target date" htmlFor={`${idPrefix}-target`}>
                    <Input
                      id={`${idPrefix}-target`}
                      type="date"
                      value={values.targetDate}
                      onChange={(event) => set("targetDate", event.target.value)}
                      disabled={disabled}
                      className="h-9 w-auto"
                    />
                  </EditRow>
                  {select("status", "Status", MILESTONE_STATUSES)}
                </>
              ) : null}

              {proposal.kind === "task" ? (
                <>
                  <EditRow label="Dates" htmlFor={`${idPrefix}-start`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        id={`${idPrefix}-start`}
                        type="date"
                        aria-label="Start date"
                        value={values.startDate}
                        onChange={(event) => set("startDate", event.target.value)}
                        disabled={disabled}
                        className="h-9 w-auto"
                      />
                      <span aria-hidden className="text-slate-400">
                        →
                      </span>
                      <Input
                        type="date"
                        aria-label="Due date"
                        value={values.dueDate}
                        onChange={(event) => set("dueDate", event.target.value)}
                        disabled={disabled}
                        className="h-9 w-auto"
                      />
                    </div>
                  </EditRow>
                  {select("status", "Status", TASK_STATUSES)}
                  {select("priority", "Priority", TASK_PRIORITY_VALUES)}
                  {milestoneSelect()}
                </>
              ) : null}

              {proposal.kind === "risk" ? (
                <>
                  <EditRow label="Mitigation" htmlFor={`${idPrefix}-mitigation`}>
                    <Textarea
                      id={`${idPrefix}-mitigation`}
                      value={values.mitigation}
                      onChange={(event) => set("mitigation", event.target.value)}
                      disabled={disabled}
                      placeholder="How this will be reduced or handled"
                      rows={2}
                      maxLength={4000}
                    />
                  </EditRow>
                  {select("impact", "Impact", RISK_LEVELS)}
                  {select("likelihood", "Likelihood", RISK_LEVELS)}
                  {select("status", "Status", RISK_STATUSES)}
                  {milestoneSelect()}
                </>
              ) : null}

              <div className="flex flex-wrap justify-end gap-2 pt-1">
                {dirty ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => setValues(baseline)}
                  >
                    Discard changes
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void save()}
                  disabled={disabled || !dirty}
                >
                  Save edit
                </Button>
              </div>
            </div>
          ) : (
            <DescriptionList>
              {proposal.kind === "task" || proposal.kind === "milestone" ? (
                <Field name="Description">
                  {proposal.description || (
                    <span className="text-slate-400">None</span>
                  )}
                </Field>
              ) : null}
              {proposal.kind === "task" ? (
                <>
                  <Field name="Dates">
                    {proposal.startDate ? formatDay(proposal.startDate) : "—"} →{" "}
                    {proposal.dueDate ? formatDay(proposal.dueDate) : "—"}
                  </Field>
                  <Field name="Priority">
                    <span className="capitalize">{proposal.priority}</span>
                  </Field>
                </>
              ) : null}
              {proposal.kind === "risk" ? (
                <Field name="Mitigation">
                  {proposal.mitigation || (
                    <span className="text-slate-400">None</span>
                  )}
                </Field>
              ) : null}
              {(proposal.kind === "task" || proposal.kind === "risk") &&
              proposal.milestone ? (
                <Field name="Milestone">{proposal.milestone.title}</Field>
              ) : null}
              {proposal.reviewedAt ? (
                <Field name="Reviewed">{formatDate(proposal.reviewedAt)}</Field>
              ) : null}
            </DescriptionList>
          )}
          <CitationList citations={proposal.citations} />
        </div>
      ) : null}
    </li>
  );
}

export function ReviewPanel({
  projectId,
  readyDocuments,
  initialRuns,
}: {
  projectId: string;
  readyDocuments: ReadyDocument[];
  initialRuns: ReviewRunView[];
}) {
  const router = useRouter();
  const activeRun = initialRuns.find(
    (run) => run.status === "processing" || run.status === "draft",
  );
  const [documentIds, setDocumentIds] = useState<Set<string>>(
    () =>
      new Set(
        readyDocuments.length <= 20
          ? readyDocuments.map((document) => document.id)
          : [],
      ),
  );
  const [runId, setRunId] = useState(activeRun?.id ?? initialRuns[0]?.id ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  const run = initialRuns.find((candidate) => candidate.id === runId) ?? initialRuns[0];
  const proposals = useMemo<Proposal[]>(
    () =>
      run
        ? [
            ...run.milestones.map((item) => ({ ...item, kind: "milestone" as const })),
            ...run.tasks.map((item) => ({ ...item, kind: "task" as const })),
            ...run.risks.map((item) => ({ ...item, kind: "risk" as const })),
            ...run.taskDependencies.map((item) => ({
              ...item,
              kind: "dependency" as const,
            })),
          ]
        : [],
    [run],
  );
  const proposalMap = new Map(proposals.map((item) => [itemKey(item), item]));
  const draftItems = proposals.filter((item) => item.generationStatus === "draft");

  async function generate() {
    if (busy || documentIds.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/generation-runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentIds: [...documentIds] }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Could not generate the draft plan.");
        router.refresh();
        return;
      }
      setRunId(data.run.id);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function review(body: Record<string, unknown>) {
    if (!run || busy) return false;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/generation-runs/${run.id}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Could not review the proposal.");
        return false;
      }
      setSelected(new Set());
      router.refresh();
      return true;
    } catch {
      setError("Could not reach the server.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function approve(items: Proposal[]) {
    await review({
      action: "approve",
      items: items.map((item) => ({ kind: item.kind, id: item.id })),
    });
  }

  const summary = run?.validatedOutput;
  const locations = new Map(
    (summary?.sourceLabels ?? []).map((source) => [source.label, source]),
  );

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <SectionHeader
          title="Generate a cited draft plan"
          description="ScopePilot proposes work only from selected ready documents. Nothing enters Tasks, Timeline, or Risks until you approve it here."
        >
          <Button
            type="button"
            onClick={() => void generate()}
            disabled={
              busy ||
              Boolean(activeRun) ||
              documentIds.size === 0 ||
              documentIds.size > 20
            }
          >
            {busy ? <Spinner className="border-white/40 border-t-white" /> : null}
            Generate draft plan
          </Button>
        </SectionHeader>

        {activeRun ? (
          <p className="mt-3 text-xs text-amber-700">
            Finish reviewing the active draft before generating another plan.
          </p>
        ) : null}
        {error ? <div className="mt-3"><ErrorState message={error} /></div> : null}

        {readyDocuments.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No ready project documents"
              description="Upload and finish processing at least one document before generating a plan."
              action={
                <LinkButton
                  href={`/projects/${projectId}/documents`}
                  variant="secondary"
                >
                  Open Documents
                </LinkButton>
              }
            />
          </div>
        ) : (
          <div className="mt-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-slate-600">
                Selected documents ({documentIds.size}/20)
              </p>
              {readyDocuments.length > 20 ? (
                <button
                  type="button"
                  className="text-xs font-medium text-blue-700 hover:underline"
                  onClick={() => setDocumentIds(new Set())}
                >
                  Clear selection
                </button>
              ) : null}
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {readyDocuments.map((document) => (
                <label
                  key={document.id}
                  className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={documentIds.has(document.id)}
                    disabled={
                      busy ||
                      (!documentIds.has(document.id) && documentIds.size >= 20)
                    }
                    onChange={(event) => {
                      const next = new Set(documentIds);
                      if (event.target.checked) next.add(document.id);
                      else next.delete(document.id);
                      setDocumentIds(next);
                    }}
                    className={`mt-0.5 ${CHECKBOX}`}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-800">
                      {document.originalFilename}
                    </span>
                    <span className="text-xs text-slate-500">
                      {document.chunkCount} indexed chunks
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
      </Card>

      {initialRuns.length === 0 ? (
        <EmptyState
          title="No generated plans yet"
          description="Select the project evidence above to create the first reviewable draft."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <label htmlFor="review-run" className="mb-1 block text-xs text-slate-500">
                Plan run history
              </label>
              <Select
                id="review-run"
                value={run?.id}
                onChange={(event) => {
                  setRunId(event.target.value);
                  setSelected(new Set());
                }}
              >
                {initialRuns.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {formatDate(candidate.createdAt)} · {candidate.status.replace("_", " ")}
                  </option>
                ))}
              </Select>
            </div>
            {run ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <Badge tone={RUN_TONE[run.status]}>{run.status.replace("_", " ")}</Badge>
                <span>{run.model}</span>
                {run.latencyMs !== null ? <span>· {(run.latencyMs / 1000).toFixed(1)}s</span> : null}
              </div>
            ) : null}
          </div>

          {run?.errorMessage ? <ErrorState message={run.errorMessage} /> : null}

          {summary ? (
            <Card className="grid gap-5 p-5 lg:grid-cols-3">
              <SummarySection title="Scope" rows={summary.scopeStatements ?? []} locations={locations} />
              <SummarySection title="Deliverables" rows={summary.deliverables ?? []} locations={locations} />
              <SummarySection title="Acceptance criteria" rows={summary.acceptanceCriteria ?? []} locations={locations} />
              {(summary.warnings?.length ?? 0) > 0 ? (
                <details className="lg:col-span-3">
                  <summary className="cursor-pointer text-xs font-medium text-amber-700">
                    {summary.warnings!.length} validation warnings
                  </summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-500">
                    {summary.warnings!.map((warning, index) => <li key={index}>{warning}</li>)}
                  </ul>
                </details>
              ) : null}
            </Card>
          ) : null}

          {run?.status === "draft" && draftItems.length > 0 ? (
            <div className="sticky top-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50/95 p-3 shadow-sm backdrop-blur">
              <span className="text-sm text-blue-900">
                {selected.size} selected · {draftItems.length} awaiting review
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy || selected.size === 0}
                  onClick={() =>
                    void approve(
                      [...selected]
                        .map((key) => proposalMap.get(key))
                        .filter((item): item is Proposal => Boolean(item)),
                    )
                  }
                >
                  Approve selected
                </Button>
                <Button type="button" size="sm" disabled={busy} onClick={() => void approve(draftItems)}>
                  Approve all
                </Button>
              </div>
            </div>
          ) : null}

          {run && proposals.length > 0 ? (
            <div className="space-y-5">
              {(
                [
                  ["milestone", "Milestones"],
                  ["task", "Tasks"],
                  ["risk", "Risks"],
                  ["dependency", "Dependencies"],
                ] as const
              ).map(([kind, title]) => {
                const group = proposals.filter((proposal) => proposal.kind === kind);
                if (group.length === 0) return null;
                const draftKeys = group
                  .filter((proposal) => proposal.generationStatus === "draft")
                  .map(itemKey);
                const selectedInGroup = draftKeys.filter((key) => selected.has(key));
                const allSelected =
                  draftKeys.length > 0 && selectedInGroup.length === draftKeys.length;
                return (
                  <section key={kind} aria-labelledby={`review-group-${kind}`}>
                    <Card className="overflow-hidden">
                      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50/60 px-3 py-2">
                        {draftKeys.length > 0 ? (
                          <input
                            type="checkbox"
                            checked={allSelected}
                            ref={(node) => {
                              if (node) {
                                node.indeterminate =
                                  selectedInGroup.length > 0 && !allSelected;
                              }
                            }}
                            onChange={() => {
                              const next = new Set(selected);
                              for (const key of draftKeys) {
                                if (allSelected) next.delete(key);
                                else next.add(key);
                              }
                              setSelected(next);
                            }}
                            disabled={busy}
                            aria-label={`Select all draft ${title.toLowerCase()}`}
                            className={CHECKBOX}
                          />
                        ) : null}
                        <h2
                          id={`review-group-${kind}`}
                          className="text-sm font-semibold text-slate-900"
                        >
                          {title}
                        </h2>
                        <span className="text-xs text-slate-400 tabular-nums">
                          {group.length}
                          {draftKeys.length > 0 && draftKeys.length < group.length
                            ? ` · ${draftKeys.length} awaiting review`
                            : ""}
                        </span>
                      </div>
                      <ul className="divide-y divide-slate-100">
                        {group.map((proposal) => {
                          const key = itemKey(proposal);
                          return (
                            <ProposalRow
                              key={key}
                              proposal={proposal}
                              tasks={run.tasks}
                              milestones={run.milestones}
                              selected={selected.has(key)}
                              disabled={busy}
                              onToggle={() => {
                                const next = new Set(selected);
                                if (next.has(key)) next.delete(key);
                                else next.add(key);
                                setSelected(next);
                              }}
                              onApprove={() => approve([proposal])}
                              onSave={async (changes) => {
                                await review({
                                  action: "edit",
                                  item: { kind: proposal.kind, id: proposal.id },
                                  changes,
                                });
                              }}
                              onReject={async () => {
                                const confirmed = await confirm({
                                  title: "Reject this suggestion?",
                                  body: "It stays in this run's history but will never become an official project record.",
                                  confirmLabel: "Reject",
                                  tone: "danger",
                                });
                                if (!confirmed) return;
                                await review({
                                  action: "reject",
                                  items: [{ kind: proposal.kind, id: proposal.id }],
                                });
                              }}
                            />
                          );
                        })}
                      </ul>
                    </Card>
                  </section>
                );
              })}
            </div>
          ) : run?.status !== "failed" && run?.status !== "processing" ? (
            <EmptyState title="No surviving proposals" description="This run did not retain any reviewable project records." />
          ) : null}
        </>
      )}
    </div>
  );
}
