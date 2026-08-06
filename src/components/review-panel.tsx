"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
import { formatDate } from "@/lib/utils";

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

function ProposalCard({
  proposal,
  tasks,
  milestones,
  selected,
  disabled,
  onToggle,
  onSave,
  onReject,
}: {
  proposal: Proposal;
  tasks: ReviewTask[];
  milestones: ReviewMilestone[];
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
  onSave: (changes: Record<string, unknown>) => Promise<void>;
  onReject: () => Promise<void>;
}) {
  const editable = proposal.generationStatus === "draft";
  const [values, setValues] = useState<Record<string, string>>(() => {
    if (proposal.kind === "milestone") {
      return {
        title: proposal.title,
        description: proposal.description ?? "",
        targetDate: day(proposal.targetDate),
        status: proposal.status,
      } as Record<string, string>;
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
      } as Record<string, string>;
    }
    if (proposal.kind === "risk") {
      return {
        description: proposal.description,
        mitigation: proposal.mitigation ?? "",
        impact: proposal.impact,
        likelihood: proposal.likelihood,
        status: proposal.status,
        milestoneId: proposal.milestone?.id ?? "",
      } as Record<string, string>;
    }
    return {
      taskId: proposal.taskId,
      dependsOnTaskId: proposal.dependsOnTaskId,
    } as Record<string, string>;
  });

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

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        {editable ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            disabled={disabled}
            aria-label="Select proposal"
            className="mt-1 size-4 rounded border-slate-300"
          />
        ) : null}
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={editable ? "info" : proposal.generationStatus === "approved" ? "success" : "neutral"}>
              {proposal.generationStatus.replace("_", " ")}
            </Badge>
            {proposal.reviewedAt ? (
              <span className="text-xs text-slate-400">
                reviewed {formatDate(proposal.reviewedAt)}
              </span>
            ) : null}
            {(proposal.kind === "task" || proposal.kind === "risk") &&
            proposal.milestone ? (
              <span className="text-xs text-slate-500">
                Milestone: {proposal.milestone.title}
              </span>
            ) : null}
          </div>

          {proposal.kind === "milestone" || proposal.kind === "task" ? (
            <Input
              aria-label={`${proposal.kind} title`}
              value={values.title}
              onChange={(event) => set("title", event.target.value)}
              disabled={!editable || disabled}
              maxLength={200}
            />
          ) : null}

          {proposal.kind !== "dependency" ? (
            <Textarea
              aria-label={proposal.kind === "risk" ? "Risk description" : "Description"}
              value={values.description}
              onChange={(event) => set("description", event.target.value)}
              disabled={!editable || disabled}
              rows={2}
              maxLength={4000}
            />
          ) : (
            <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
              <Select
                aria-label="Dependent task"
                value={values.taskId}
                onChange={(event) => set("taskId", event.target.value)}
                disabled={!editable || disabled}
                className="w-full"
              >
                {taskOptions.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </Select>
              <span className="text-center text-xs text-slate-500">depends on</span>
              <Select
                aria-label="Prerequisite task"
                value={values.dependsOnTaskId}
                onChange={(event) => set("dependsOnTaskId", event.target.value)}
                disabled={!editable || disabled}
                className="w-full"
              >
                {taskOptions.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {proposal.kind === "milestone" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                type="date"
                aria-label="Target date"
                value={values.targetDate}
                onChange={(event) => set("targetDate", event.target.value)}
                disabled={!editable || disabled}
              />
              <Select
                aria-label="Milestone status"
                value={values.status}
                onChange={(event) => set("status", event.target.value)}
                disabled={!editable || disabled}
              >
                {[
                  "not_started",
                  "on_track",
                  "at_risk",
                  "blocked",
                  "completed",
                ].map((status) => (
                  <option key={status} value={status}>
                    {status.replaceAll("_", " ")}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          {proposal.kind === "task" ? (
            <div className="grid gap-2 sm:grid-cols-5">
              <Input
                type="date"
                aria-label="Start date"
                value={values.startDate}
                onChange={(event) => set("startDate", event.target.value)}
                disabled={!editable || disabled}
              />
              <Input
                type="date"
                aria-label="Due date"
                value={values.dueDate}
                onChange={(event) => set("dueDate", event.target.value)}
                disabled={!editable || disabled}
              />
              <Select
                aria-label="Task status"
                value={values.status}
                onChange={(event) => set("status", event.target.value)}
                disabled={!editable || disabled}
              >
                {["backlog", "todo", "in_progress", "blocked", "done"].map(
                  (status) => (
                    <option key={status} value={status}>
                      {status.replaceAll("_", " ")}
                    </option>
                  ),
                )}
              </Select>
              <Select
                aria-label="Task priority"
                value={values.priority}
                onChange={(event) => set("priority", event.target.value)}
                disabled={!editable || disabled}
              >
                {["low", "medium", "high", "urgent"].map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </Select>
              <Select
                aria-label="Task milestone"
                value={values.milestoneId}
                onChange={(event) => set("milestoneId", event.target.value)}
                disabled={!editable || disabled}
              >
                <option value="">No milestone</option>
                {milestoneOptions.map((milestone) => (
                  <option key={milestone.id} value={milestone.id}>
                    {milestone.title}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          {proposal.kind === "risk" ? (
            <>
              <Textarea
                aria-label="Risk mitigation"
                value={values.mitigation}
                onChange={(event) => set("mitigation", event.target.value)}
                disabled={!editable || disabled}
                placeholder="Mitigation"
                rows={2}
                maxLength={4000}
              />
              <div className="grid gap-2 sm:grid-cols-4">
                {(["impact", "likelihood"] as const).map((field) => (
                  <Select
                    key={field}
                    aria-label={field}
                    value={values[field]}
                    onChange={(event) => set(field, event.target.value)}
                    disabled={!editable || disabled}
                  >
                    {["low", "medium", "high"].map((level) => (
                      <option key={level} value={level}>
                        {field}: {level}
                      </option>
                    ))}
                  </Select>
                ))}
                <Select
                  aria-label="Risk status"
                  value={values.status}
                  onChange={(event) => set("status", event.target.value)}
                  disabled={!editable || disabled}
                >
                  {["open", "monitoring", "mitigated", "accepted"].map(
                    (status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ),
                  )}
                </Select>
                <Select
                  aria-label="Risk milestone"
                  value={values.milestoneId}
                  onChange={(event) => set("milestoneId", event.target.value)}
                  disabled={!editable || disabled}
                >
                  <option value="">No milestone</option>
                  {milestoneOptions.map((milestone) => (
                    <option key={milestone.id} value={milestone.id}>
                      {milestone.title}
                    </option>
                  ))}
                </Select>
              </div>
            </>
          ) : null}

          {editable ? (
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void onReject()}
                disabled={disabled}
              >
                Reject
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void save()}
                disabled={disabled}
              >
                Save edit
              </Button>
            </div>
          ) : null}
          <CitationList citations={proposal.citations} />
        </div>
      </div>
    </Card>
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
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">Generate a cited draft plan</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              ScopePilot proposes work only from selected ready documents. Nothing
              enters Tasks, Timeline, or Risks until you approve it here.
            </p>
          </div>
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
        </div>

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
                <Link className="text-sm font-medium text-blue-700 hover:underline" href={`/projects/${projectId}/documents`}>
                  Open Documents
                </Link>
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
                    className="mt-0.5 size-4 rounded border-slate-300"
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
            <div className="space-y-7">
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
                return (
                  <section key={kind}>
                    <h2 className="mb-2 text-sm font-semibold">{title} <span className="font-normal text-slate-400">{group.length}</span></h2>
                    <div className="space-y-3">
                      {group.map((proposal) => {
                        const key = itemKey(proposal);
                        return (
                          <ProposalCard
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
                    </div>
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
