"use client";

import {
  EMPTY_REQUIREMENT_FILTER,
  type RegisterFilter,
  type RequirementFilter,
  requirementMatches,
} from "@/lib/pm/filters";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Check,
  ChevronRight,
  Download,
  FileText,
  Grid3x3,
  ListChecks,
  Sparkles,
} from "lucide-react";
import { TraceabilityMatrix } from "@/components/traceability-matrix";
import {
  Badge,
  Button,
  buttonClasses,
  Card,
  CHECKBOX,
  DescriptionList,
  EmptyState,
  ErrorState,
  Field,
  FOCUS_RING,
  Input,
  SearchField,
  SectionHeader,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { formatRequirementCode } from "@/lib/pm/rules";
import { cn } from "@/lib/utils";

export type RequirementType =
  | "business"
  | "functional"
  | "non_functional"
  | "constraint";
export type RequirementPriority = "must" | "should" | "could" | "wont";
export type RequirementStatus =
  | "draft"
  | "needs_clarification"
  | "validated"
  | "approved"
  | "rejected";
export type RequirementConfidence = "high" | "medium" | "low";

export interface RequirementCitationRow {
  id: string;
  excerpt: string | null;
  chunk: {
    id: string;
    pageNumber: number | null;
    sectionTitle: string | null;
    document: { id: string; originalFilename: string };
  };
}

export interface RequirementLinkRow {
  id: string;
  targetType: "task" | "milestone" | "risk";
  task: {
    id: string;
    title: string;
    status: { id: string; key: string; label: string; category: string };
  } | null;
  milestone: { id: string; title: string; status: string } | null;
  risk: { id: string; description: string; status: string } | null;
}

export interface RequirementRow {
  id: string;
  sequence: number;
  title: string;
  description: string | null;
  type: RequirementType;
  priority: RequirementPriority;
  status: RequirementStatus;
  acceptanceCriteria: string | null;
  assumptions: string | null;
  confidence: RequirementConfidence;
  stakeholder: string | null;
  source: "manual" | "ai_suggested";
  generationStatus: "not_applicable" | "draft" | "approved" | "rejected";
  citations: RequirementCitationRow[];
  links: RequirementLinkRow[];
}

export interface TaskOption {
  id: string;
  title: string;
}

export interface ReadyDocument {
  id: string;
  originalFilename: string;
  chunkCount: number;
}

export interface RequirementRunSummary {
  id: string;
  status:
    | "processing"
    | "draft"
    | "approved"
    | "partially_approved"
    | "rejected"
    | "failed";
  errorMessage: string | null;
  createdAt: string;
}

const MAX_DOCUMENTS = 20;

const TYPES: Array<{ value: RequirementType; label: string }> = [
  { value: "business", label: "Business" },
  { value: "functional", label: "Functional" },
  { value: "non_functional", label: "Non-functional" },
  { value: "constraint", label: "Constraint" },
];

const PRIORITIES: Array<{ value: RequirementPriority; label: string }> = [
  { value: "must", label: "Must" },
  { value: "should", label: "Should" },
  { value: "could", label: "Could" },
  { value: "wont", label: "Won't" },
];

const STATUSES: Array<{ value: RequirementStatus; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "needs_clarification", label: "Needs clarification" },
  { value: "validated", label: "Validated" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

const CONFIDENCES: Array<{ value: RequirementConfidence; label: string }> = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const STATUS_TONE = {
  draft: "neutral",
  needs_clarification: "warning",
  validated: "info",
  approved: "success",
  rejected: "danger",
} as const;

const STATUS_DOT = {
  draft: "bg-slate-400",
  needs_clarification: "bg-amber-500",
  validated: "bg-blue-500",
  approved: "bg-emerald-500",
  rejected: "bg-red-500",
} as const;

/**
 * MoSCoW rendered as weight rather than colour. Four coloured priority badges on
 * every row competed with the status badge; only `must` earns emphasis, because
 * it is the only value that changes what you do next.
 */
const PRIORITY_STYLE = {
  must: "bg-slate-900 text-white",
  should: "bg-slate-100 text-slate-700",
  could: "bg-slate-50 text-slate-500",
  wont: "bg-slate-50 text-slate-400 line-through",
} as const;



interface Draft {
  title: string;
  description: string;
  type: RequirementType;
  priority: RequirementPriority;
  status: RequirementStatus;
  acceptanceCriteria: string;
  assumptions: string;
  confidence: RequirementConfidence;
  stakeholder: string;
}

const EMPTY: Draft = {
  title: "",
  description: "",
  type: "functional",
  priority: "should",
  status: "draft",
  acceptanceCriteria: "",
  assumptions: "",
  confidence: "medium",
  stakeholder: "",
};

function label(value: string) {
  return value.replaceAll("_", " ");
}

function taskLinks(requirement: RequirementRow) {
  return requirement.links.filter((link) => link.targetType === "task");
}

/** The gap the register exists to surface: agreed scope with no delivery. */
function isUncovered(requirement: RequirementRow) {
  return requirement.status === "approved" && taskLinks(requirement).length === 0;
}

/**
 * Badges are for exceptions, not for every field.
 *
 * The first version badged type, priority, status, confidence, and source on all
 * of them, which meant nothing stood out. These are the conditions a reviewer
 * has to act on; everything else lives in the expanded body.
 */
function warningsFor(
  requirement: RequirementRow,
  deliveryEnabled: boolean,
): string[] {
  const warnings: string[] = [];
  // "No task" is only a gap when this project tracks delivery here; otherwise
  // it would badge every agreed requirement for work that lives elsewhere.
  if (deliveryEnabled && isUncovered(requirement)) warnings.push("no task");
  if (requirement.status === "approved" && !requirement.acceptanceCriteria) {
    warnings.push("no criteria");
  }
  if (requirement.confidence === "low" && requirement.status !== "rejected") {
    warnings.push("low confidence");
  }
  return warnings;
}

export interface LinkTargetOption {
  id: string;
  label: string;
}

/**
 * Linked records as removable chips, plus an inline picker for one more.
 *
 * One component for tasks, milestones, and risks, so the three edges of the
 * traceability matrix cannot drift apart. Only official records reach
 * `options` — the API refuses anything else — so a link can never be satisfied
 * by a draft proposal.
 */
function LinkEditor({
  noun,
  code,
  links,
  options,
  empty,
  busy,
  onLink,
  onUnlink,
}: {
  noun: string;
  code: string;
  links: Array<{ id: string; targetId: string; label: string; done: boolean }>;
  options: LinkTargetOption[];
  empty: React.ReactNode;
  busy: boolean;
  onLink: (targetId: string) => Promise<void>;
  onUnlink: (linkId: string) => Promise<void>;
}) {
  const [picking, setPicking] = useState(false);
  const available = options.filter(
    (option) => !links.some((link) => link.targetId === option.id),
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {links.length === 0 ? (
        <span className="text-slate-400">{empty}</span>
      ) : (
        links.map((link) => (
          <span
            key={link.id}
            className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700"
          >
            {link.done ? (
              <Check
                className="size-3 shrink-0 text-emerald-600"
                aria-label="done"
              />
            ) : null}
            <span className="min-w-0 truncate" title={link.label}>
              {link.label}
            </span>
            <button
              type="button"
              aria-label={`Unlink ${link.label}`}
              className="text-slate-400 hover:text-red-700"
              disabled={busy}
              onClick={() => void onUnlink(link.id)}
            >
              ×
            </button>
          </span>
        ))
      )}

      {picking ? (
        <Select
          aria-label={`Link a ${noun} to ${code}`}
          className="h-7 max-w-xs py-0 text-xs"
          defaultValue=""
          disabled={busy}
          // Focus lands on the picker the moment it replaces the button, so a
          // keyboard user is not left on an element that just disappeared.
          autoFocus
          onBlur={() => setPicking(false)}
          onChange={async (event) => {
            const targetId = event.target.value;
            if (!targetId) return;
            await onLink(targetId);
            setPicking(false);
          }}
        >
          <option value="">Select a {noun}…</option>
          {available.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
      ) : (
        <button
          type="button"
          className="text-xs font-medium text-blue-700 hover:underline disabled:opacity-50"
          disabled={busy || available.length === 0}
          title={
            options.length === 0
              ? `This project has no official ${noun}s yet`
              : undefined
          }
          onClick={() => setPicking(true)}
        >
          + Link {noun}
        </button>
      )}
    </div>
  );
}

/** Muted label + readable content, so the body has one measure instead of four. */
export function RequirementsPanel({
  projectId,
  initialRequirements,
  readyDocuments,
  taskOptions,
  milestoneOptions,
  riskOptions,
  activeRun,
  initialFilter = "all",
  initialOpenId = null,
  deliveryEnabled,
}: {
  projectId: string;
  /** Delivery tabs on: task/milestone/risk links, gaps, and the matrix show. */
  deliveryEnabled: boolean;
  initialFilter?: RegisterFilter;
  milestoneOptions: LinkTargetOption[];
  riskOptions: LinkTargetOption[];
  /** From `?req=`: a traced-requirement chip elsewhere opens this row. */
  initialOpenId?: string | null;
  initialRequirements: RequirementRow[];
  readyDocuments: ReadyDocument[];
  taskOptions: TaskOption[];
  activeRun: RequirementRunSummary | null;
}) {
  const router = useRouter();
  const [requirements, setRequirements] = useState(initialRequirements);
  const [filter, setFilter] = useState<RegisterFilter>(initialFilter);
  const [refine, setRefine] = useState<RequirementFilter>(EMPTY_REQUIREMENT_FILTER);
  const [view, setView] = useState<"register" | "matrix">("register");
  const [expanded, setExpanded] = useState<Set<string>>(
    () =>
      new Set(
        initialOpenId &&
          initialRequirements.some((item) => item.id === initialOpenId)
          ? [initialOpenId]
          : [],
      ),
  );

  // Bring a deep-linked row into view once. Scrolling is a side effect on the
  // DOM, not state, so it belongs in an effect rather than in render.
  useEffect(() => {
    if (!initialOpenId) return;
    document
      .getElementById(`requirement-${initialOpenId}`)
      ?.scrollIntoView({ block: "center" });
  }, [initialOpenId]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const confirm = useConfirm();
  const toast = useToast();
  const [bulkBusy, setBulkBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showExtract, setShowExtract] = useState(initialRequirements.length === 0);
  const [documentIds, setDocumentIds] = useState<Set<string>>(
    () =>
      new Set(
        readyDocuments.length <= MAX_DOCUMENTS
          ? readyDocuments.map((document) => document.id)
          : [],
      ),
  );

  const uncoveredCount = requirements.filter(isUncovered).length;
  const approvedCount = requirements.filter(
    (item) => item.status === "approved",
  ).length;
  // The status chips and the refine controls are separate axes: chips pick a
  // lifecycle slice, refine narrows within it. Chip counts stay unrefined so
  // they still describe the register rather than the current search.
  const refineActive =
    refine.query.trim() !== "" ||
    refine.type !== null ||
    refine.priority !== null ||
    refine.confidence !== null;
  const visible = (
    filter === "all"
      ? requirements
      : filter === "gaps"
        ? requirements.filter(isUncovered)
        : requirements.filter((item) => item.status === filter)
  ).filter((item) => !refineActive || requirementMatches(item, refine));
  const visibleIds = visible.map((item) => item.id);
  const selectedVisible = visibleIds.filter((id) => selected.has(id));
  const allVisibleSelected =
    visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
  const someVisibleSelected =
    selectedVisible.length > 0 && !allVisibleSelected;

  function upsert(requirement: RequirementRow) {
    setRequirements((previous) =>
      previous.some((item) => item.id === requirement.id)
        ? previous.map((item) =>
            item.id === requirement.id ? requirement : item,
          )
        : [...previous, requirement],
    );
  }

  function toggleExpanded(id: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelected(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * Select-all covers the *filtered* rows only. Selecting rows the current
   * filter is hiding would make a batch action reach records the reviewer
   * cannot see — the filter is the working set.
   */
  function toggleSelectAll() {
    setSelected((previous) => {
      if (visibleIds.every((id) => previous.has(id))) {
        const next = new Set(previous);
        for (const id of visibleIds) next.delete(id);
        return next;
      }
      return new Set([...previous, ...visibleIds]);
    });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || !draft.title.trim() || saving) return;

    setSaving(true);
    setError(null);
    try {
      const editing = editingId !== null;
      const response = await fetch(
        editing
          ? `/api/requirements/${editingId}`
          : `/api/projects/${projectId}/requirements`,
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: draft.title.trim(),
            description: draft.description.trim() || null,
            type: draft.type,
            priority: draft.priority,
            status: draft.status,
            acceptanceCriteria: draft.acceptanceCriteria.trim() || null,
            assumptions: draft.assumptions.trim() || null,
            confidence: draft.confidence,
            stakeholder: draft.stakeholder.trim() || null,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Could not save the requirement.");
        return;
      }
      upsert(data.requirement);
      setDraft(null);
      setEditingId(null);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  async function patchStatus(id: string, status: RequirementStatus) {
    const response = await fetch(`/api/requirements/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, data };
  }

  async function changeStatus(
    requirement: RequirementRow,
    status: RequirementStatus,
  ) {
    setBusyId(requirement.id);
    setError(null);
    try {
      const { ok, data } = await patchStatus(requirement.id, status);
      if (!ok) {
        setError(data.error ?? "Could not update the requirement.");
        return;
      }
      upsert(data.requirement);
      // A review transition can close out the run, so its badge must refresh.
      if (requirement.source === "ai_suggested") router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Reviewing a whole extraction one row at a time is the workflow this page
   * exists for, so it gets a first-class path. Each PATCH still runs its own
   * optimistic-concurrency check server-side; a row another reviewer already
   * moved fails on its own without taking the batch with it.
   */
  async function applyBulkStatus(status: RequirementStatus) {
    if (selectedVisible.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    setError(null);
    try {
      const results = await Promise.all(
        selectedVisible.map(async (id) => {
          try {
            return await patchStatus(id, status);
          } catch {
            return { ok: false, data: {} as { error?: string } };
          }
        }),
      );
      const failed = results.filter((result) => !result.ok);
      for (const result of results) {
        if (result.ok) upsert(result.data.requirement);
      }
      if (failed.length > 0) {
        setError(
          `${failed.length} of ${results.length} could not be updated. ${
            failed[0].data.error ?? "Reload and try again."
          }`,
        );
      }
      setSelected(new Set());
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  async function link(
    requirement: RequirementRow,
    targetType: "task" | "milestone" | "risk",
    targetId: string,
  ) {
    if (!targetId) return;
    setBusyId(requirement.id);
    setError(null);
    try {
      const response = await fetch(`/api/requirements/${requirement.id}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType, targetId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? `Could not link that ${targetType}.`);
        return;
      }
      upsert(data.requirement);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusyId(null);
    }
  }

  async function unlink(requirement: RequirementRow, linkId: string) {
    setBusyId(requirement.id);
    setError(null);
    try {
      const response = await fetch(
        `/api/requirements/${requirement.id}/links/${linkId}`,
        { method: "DELETE" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Could not remove that link.");
        return;
      }
      upsert(data.requirement);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(requirement: RequirementRow) {
    const code = formatRequirementCode(requirement.sequence);
    const confirmed = await confirm({
      title: `Delete ${code}?`,
      body: <p className="italic">“{requirement.title}”</p>,
      confirmLabel: "Delete requirement",
      tone: "danger",
    });
    if (!confirmed) return;

    setBusyId(requirement.id);
    setError(null);
    try {
      const response = await fetch(`/api/requirements/${requirement.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? "Could not delete the requirement.");
        return;
      }
      setRequirements((previous) =>
        previous.filter((item) => item.id !== requirement.id),
      );
      toast.success(`Deleted ${code}`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusyId(null);
    }
  }

  async function extract() {
    if (extracting || documentIds.size === 0) return;
    setExtracting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/requirement-runs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentIds: [...documentIds] }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Could not extract requirements.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setExtracting(false);
    }
  }

  function startEdit(requirement: RequirementRow) {
    setEditingId(requirement.id);
    setDraft({
      title: requirement.title,
      description: requirement.description ?? "",
      type: requirement.type,
      priority: requirement.priority,
      status: requirement.status,
      acceptanceCriteria: requirement.acceptanceCriteria ?? "",
      assumptions: requirement.assumptions ?? "",
      confidence: requirement.confidence,
      stakeholder: requirement.stakeholder ?? "",
    });
  }

  const statusFilters: Array<{
    value: RegisterFilter;
    label: string;
    count: number;
  }> = [
    { value: "all", label: "All", count: requirements.length },
    ...STATUSES.map((status) => ({
      value: status.value as RegisterFilter,
      label: status.label,
      count: requirements.filter((item) => item.status === status.value).length,
    })),
  ];

  return (
    <div className="space-y-4">
      {/* Extraction collapses once the register has content: it is a setup step,
          not something you look at while reviewing 19 requirements. */}
      <Card className="overflow-hidden">
        <button
          type="button"
          onClick={() => setShowExtract((open) => !open)}
          aria-expanded={showExtract}
          className="flex w-full items-center gap-2.5 px-4 py-3 text-left hover:bg-slate-50"
        >
          <Sparkles className="size-4 shrink-0 text-slate-400" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-slate-900">
              Extract requirements from documents
            </span>
            <span className="block text-xs text-slate-500">
              {readyDocuments.length === 0
                ? "No indexed documents yet"
                : `${documentIds.size} of ${readyDocuments.length} indexed document${readyDocuments.length === 1 ? "" : "s"} selected`}
              {activeRun ? " · drafts awaiting review" : ""}
            </span>
          </span>
          <ChevronRight
            className={cn(
              "size-4 shrink-0 text-slate-400 transition-transform",
              showExtract && "rotate-90",
            )}
          />
        </button>

        {showExtract ? (
          <div className="border-t border-slate-100 px-4 py-4">
            <p className="max-w-2xl text-sm text-slate-600">
              ScopePilot reads only the documents you select and cites every
              requirement it proposes. Extracted requirements arrive as drafts —
              nothing becomes agreed scope until you approve it here.
            </p>

            {readyDocuments.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  title="No ready project documents"
                  description="Upload and finish processing at least one document before extracting requirements."
                  action={
                    <Link
                      className="text-sm font-medium text-blue-700 hover:underline"
                      href={`/projects/${projectId}/documents`}
                    >
                      Open Documents
                    </Link>
                  }
                />
              </div>
            ) : (
              <>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {readyDocuments.map((document) => (
                    <label
                      key={document.id}
                      className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-2.5 text-sm hover:border-slate-300"
                    >
                      <input
                        type="checkbox"
                        checked={documentIds.has(document.id)}
                        disabled={
                          extracting ||
                          (!documentIds.has(document.id) &&
                            documentIds.size >= MAX_DOCUMENTS)
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

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    onClick={() => void extract()}
                    disabled={
                      extracting ||
                      Boolean(activeRun) ||
                      documentIds.size === 0 ||
                      documentIds.size > MAX_DOCUMENTS
                    }
                  >
                    {extracting ? (
                      <Spinner className="border-white/40 border-t-white" />
                    ) : null}
                    Extract draft requirements
                  </Button>
                  {activeRun ? (
                    <p className="text-xs text-amber-700">
                      {activeRun.status === "processing"
                        ? "An extraction is still running."
                        : "Review the drafts from the last extraction before running another."}
                    </p>
                  ) : null}
                </div>
              </>
            )}
          </div>
        ) : null}
      </Card>

      {error ? <ErrorState message={error} /> : null}

      <SectionHeader
        title="Requirement register"
        description={
          <>
            {requirements.length} recorded ·{" "}
            {/* "Every approved requirement is covered" reads as reassurance, so
                it must not be shown when nothing has been approved at all. */}
            {approvedCount === 0 ? (
              "none approved yet — nothing here is agreed scope"
            ) : !deliveryEnabled ? (
              `${approvedCount} approved`
            ) : uncoveredCount === 0 ? (
              `all ${approvedCount} approved have a delivery task`
            ) : (
              <span className="font-medium text-red-700">
                {uncoveredCount} of {approvedCount} approved have no delivery task
              </span>
            )}
          </>
        }
      >
        {deliveryEnabled ? (
        <div
          role="group"
          aria-label="Requirements view"
          className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5"
        >
          {(
            [
              ["register", "Register", ListChecks],
              ["matrix", "Matrix", Grid3x3],
            ] as const
          ).map(([value, text, Icon]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => setView(value)}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                FOCUS_RING,
                view === value
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-900",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {text}
            </button>
          ))}
        </div>
        ) : null}
        {view === "register" ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() =>
            setExpanded((previous) =>
              previous.size > 0 ? new Set() : new Set(visibleIds),
            )
          }
        >
          {expanded.size > 0 ? "Collapse all" : "Expand all"}
        </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            setEditingId(null);
            setDraft({ ...EMPTY });
          }}
        >
          New requirement
        </Button>
        {requirements.length > 0 ? (
          // Plain anchors: the route answers with Content-Disposition, so the
          // browser downloads without any client-side state.
          <div className="flex items-center gap-1" role="group" aria-label="Export">
            <Download className="size-3.5 text-slate-400" aria-hidden />
            {(
              [
                ["csv", "CSV"],
                ["md", "Markdown"],
              ] as const
            ).map(([format, text]) => (
              <a
                key={format}
                href={`/api/projects/${projectId}/requirements/export?format=${format}`}
                download
                className={buttonClasses({
                  variant: "ghost",
                  size: "sm",
                  className: "px-2",
                })}
                aria-label={`Export requirements as ${text}`}
              >
                {text}
              </a>
            ))}
          </div>
        ) : null}
      </SectionHeader>

      {draft ? (
        <Card className="p-4">
          <form onSubmit={save} className="space-y-3">
            <p className="text-sm font-medium">
              {editingId ? "Edit requirement" : "New requirement"}
            </p>

            <div>
              <label
                htmlFor="requirement-title"
                className="mb-1.5 block text-sm font-medium"
              >
                Title
              </label>
              <Input
                id="requirement-title"
                value={draft.title}
                onChange={(event) =>
                  setDraft({ ...draft, title: event.target.value })
                }
                placeholder="e.g. Managers approve leave requests within the portal"
                maxLength={200}
                disabled={saving}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label
                  htmlFor="requirement-type"
                  className="mb-1 block text-xs text-slate-500"
                >
                  Type
                </label>
                <Select
                  id="requirement-type"
                  className="w-full"
                  value={draft.type}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      type: event.target.value as RequirementType,
                    })
                  }
                  disabled={saving}
                >
                  {TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label
                  htmlFor="requirement-priority"
                  className="mb-1 block text-xs text-slate-500"
                >
                  Priority
                </label>
                <Select
                  id="requirement-priority"
                  className="w-full"
                  value={draft.priority}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      priority: event.target.value as RequirementPriority,
                    })
                  }
                  disabled={saving}
                >
                  {PRIORITIES.map((priority) => (
                    <option key={priority.value} value={priority.value}>
                      {priority.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label
                  htmlFor="requirement-status"
                  className="mb-1 block text-xs text-slate-500"
                >
                  Status
                </label>
                <Select
                  id="requirement-status"
                  className="w-full"
                  value={draft.status}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      status: event.target.value as RequirementStatus,
                    })
                  }
                  disabled={saving}
                >
                  {STATUSES.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label
                  htmlFor="requirement-confidence"
                  className="mb-1 block text-xs text-slate-500"
                >
                  Confidence
                </label>
                <Select
                  id="requirement-confidence"
                  className="w-full"
                  value={draft.confidence}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      confidence: event.target.value as RequirementConfidence,
                    })
                  }
                  disabled={saving}
                >
                  {CONFIDENCES.map((confidence) => (
                    <option key={confidence.value} value={confidence.value}>
                      {confidence.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div>
              <label
                htmlFor="requirement-description"
                className="mb-1.5 block text-sm font-medium"
              >
                Description{" "}
                <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <Textarea
                id="requirement-description"
                value={draft.description}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
                rows={2}
                maxLength={4000}
                disabled={saving}
              />
            </div>

            <div>
              <label
                htmlFor="requirement-acceptance"
                className="mb-1.5 block text-sm font-medium"
              >
                Acceptance criteria{" "}
                <span className="font-normal text-slate-500">
                  (how this is verified)
                </span>
              </label>
              <Textarea
                id="requirement-acceptance"
                value={draft.acceptanceCriteria}
                onChange={(event) =>
                  setDraft({ ...draft, acceptanceCriteria: event.target.value })
                }
                rows={2}
                maxLength={4000}
                disabled={saving}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="requirement-assumptions"
                  className="mb-1.5 block text-sm font-medium"
                >
                  Assumptions{" "}
                  <span className="font-normal text-slate-500">(optional)</span>
                </label>
                <Textarea
                  id="requirement-assumptions"
                  value={draft.assumptions}
                  onChange={(event) =>
                    setDraft({ ...draft, assumptions: event.target.value })
                  }
                  rows={2}
                  maxLength={4000}
                  disabled={saving}
                />
              </div>
              <div>
                <label
                  htmlFor="requirement-stakeholder"
                  className="mb-1.5 block text-sm font-medium"
                >
                  Stakeholder{" "}
                  <span className="font-normal text-slate-500">(optional)</span>
                </label>
                <Input
                  id="requirement-stakeholder"
                  value={draft.stakeholder}
                  onChange={(event) =>
                    setDraft({ ...draft, stakeholder: event.target.value })
                  }
                  placeholder="e.g. Security owner"
                  maxLength={200}
                  disabled={saving}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setDraft(null);
                  setEditingId(null);
                }}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !draft.title.trim()}>
                {saving ? (
                  <>
                    <Spinner className="border-white/40 border-t-white" />
                    Saving…
                  </>
                ) : editingId ? (
                  "Save changes"
                ) : (
                  "Create requirement"
                )}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {requirements.length === 0 && !draft ? (
        <EmptyState
          title="No requirements yet"
          description="Extract drafts from a project document, or record the first requirement by hand."
          action={
            <Button
              type="button"
              onClick={() => {
                setEditingId(null);
                setDraft({ ...EMPTY });
              }}
            >
              Record the first requirement
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {/* Two groups with a wide gap rather than one row with a divider: a
              `w-px` separator dangles at the end of a wrapped line, and the Gaps
              chip orphaned onto its own row. Grouped, they wrap together. */}
          <div
            role="group"
            aria-label="Filter the requirement register"
            className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-slate-200 bg-slate-50/60 px-3 py-2.5"
          >
            <div className="flex flex-wrap items-center gap-1.5">
            {statusFilters.map((entry) => {
              const selectedFilter = filter === entry.value;
              const dot =
                entry.value === "all"
                  ? null
                  : STATUS_DOT[entry.value as RequirementStatus];

              return (
                <button
                  key={entry.value}
                  type="button"
                  aria-pressed={selectedFilter}
                  onClick={() => setFilter(entry.value)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
                    selectedFilter
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900",
                  )}
                >
                  {dot ? (
                    <span aria-hidden className={cn("size-1.5 rounded-full", dot)} />
                  ) : null}
                  {entry.label}
                  <span
                    className={cn(
                      "tabular-nums",
                      selectedFilter ? "text-slate-300" : "text-slate-400",
                    )}
                  >
                    {entry.count}
                  </span>
                </button>
              );
            })}
            </div>

            {/* Gaps cuts across the lifecycle statuses rather than being one of
                them, so it is a separate group. */}
            {deliveryEnabled ? (
            <button
              type="button"
              aria-pressed={filter === "gaps"}
              onClick={() => setFilter("gaps")}
              className={cn(
                "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
                filter === "gaps"
                  ? "border-red-700 bg-red-700 text-white"
                  : uncoveredCount > 0
                    ? "border-red-200 bg-white text-red-700 hover:border-red-300"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
              )}
            >
              Gaps
              <span
                className={cn(
                  "tabular-nums",
                  filter === "gaps" ? "text-red-200" : "text-slate-400",
                )}
              >
                {uncoveredCount}
              </span>
            </button>
            ) : null}
          </div>

          <div
            role="search"
            aria-label="Search the requirement register"
            className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2"
          >
            <SearchField
              label="Search requirements"
              placeholder="Search code, title, criteria, stakeholder"
              value={refine.query}
              onChange={(event) =>
                setRefine((previous) => ({ ...previous, query: event.target.value }))
              }
              className="w-full sm:w-72"
            />
            {(
              [
                ["type", "Any type", TYPES],
                ["priority", "Any priority", PRIORITIES],
                ["confidence", "Any confidence", CONFIDENCES],
              ] as const
            ).map(([key, anyLabel, options]) => (
              <Select
                key={key}
                aria-label={`Filter by ${key}`}
                value={refine[key] ?? ""}
                onChange={(event) =>
                  setRefine((previous) => ({
                    ...previous,
                    [key]: event.target.value || null,
                  }))
                }
                className="h-8 text-xs"
              >
                <option value="">{anyLabel}</option>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            ))}
            {refineActive ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setRefine(EMPTY_REQUIREMENT_FILTER)}
              >
                Clear
              </Button>
            ) : null}
          </div>

          {view === "matrix" && deliveryEnabled ? (
            <TraceabilityMatrix
              projectId={projectId}
              requirements={visible}
              onOpen={(id) => {
                setView("register");
                setExpanded((previous) => new Set(previous).add(id));
                requestAnimationFrame(() =>
                  document
                    .getElementById(`requirement-${id}`)
                    ?.scrollIntoView({ block: "center" }),
                );
              }}
            />
          ) : (
          <>
          {/* Reviewing a whole extraction is the point of this page, so the
              batch path is first-class rather than 19 individual dropdowns. */}
          {selectedVisible.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-900 px-3 py-2 text-white">
              <span className="text-xs font-medium">
                {selectedVisible.length} selected
              </span>
              {!allVisibleSelected ? (
                <button
                  type="button"
                  className="text-xs text-white/80 underline hover:text-white"
                  onClick={toggleSelectAll}
                >
                  Select all {visible.length}
                </button>
              ) : null}
              <span aria-hidden className="mx-1 h-4 w-px bg-white/20" />
              {(
                [
                  ["approved", "Approve"],
                  ["validated", "Validate"],
                  ["needs_clarification", "Needs clarification"],
                  ["rejected", "Reject"],
                  // Without a way back, one mis-aimed batch approval could only
                  // be undone a row at a time. Undo belongs wherever bulk does.
                  ["draft", "Back to draft"],
                ] as Array<[RequirementStatus, string]>
              ).map(([status, text]) => (
                <button
                  key={status}
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => void applyBulkStatus(status)}
                  className="inline-flex h-7 items-center rounded-md border border-white/25 px-2.5 text-xs font-medium hover:bg-white/10 disabled:opacity-50"
                >
                  {text}
                </button>
              ))}
              {bulkBusy ? <Spinner className="border-white/30 border-t-white" /> : null}
              <button
                type="button"
                className="ml-auto text-xs text-white/70 hover:text-white"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </button>
            </div>
          ) : null}

          {visible.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-slate-500">
              {refineActive
                ? "No requirements match this search."
                : filter === "gaps"
                  ? "Every approved requirement has at least one delivery task."
                  : `No ${label(filter)} requirements.`}
            </div>
          ) : (
            <>
            {/* Aligned with the row checkboxes so the column reads as a column. */}
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/40 px-3 py-1.5">
              <input
                type="checkbox"
                aria-label={
                  allVisibleSelected
                    ? "Clear selection"
                    : `Select all ${visible.length} shown requirements`
                }
                checked={allVisibleSelected}
                ref={(node) => {
                  // React has no `indeterminate` prop; the partial state has to
                  // be set on the DOM node directly.
                  if (node) node.indeterminate = someVisibleSelected;
                }}
                onChange={toggleSelectAll}
                className="size-4 shrink-0 rounded border-slate-300"
              />
              <span className="text-xs text-slate-500">
                {selectedVisible.length > 0
                  ? `${selectedVisible.length} of ${visible.length} selected`
                  : `${visible.length} shown${
                      filter === "all" && !refineActive
                        ? ""
                        : ` of ${requirements.length}`
                    }`}
              </span>
            </div>
            <ul className="divide-y divide-slate-100">
              {visible.map((requirement) => {
                const links = taskLinks(requirement);
                const busy = busyId === requirement.id;
                const open = expanded.has(requirement.id);
                const warnings = warningsFor(requirement, deliveryEnabled);
                const code = formatRequirementCode(requirement.sequence);

                return (
                  <li
                    key={requirement.id}
                    id={`requirement-${requirement.id}`}
                    className="scroll-mt-24"
                  >
                    {/* Wraps below `sm`: at 375px the fixed-width badges left
                        roughly 60px for the title, truncating every row to
                        "Evalua…". The metadata drops to its own line instead. */}
                    <div
                      className={cn(
                        "flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 transition-colors",
                        open ? "bg-slate-50" : "hover:bg-slate-50/70",
                      )}
                    >
                      <input
                        type="checkbox"
                        aria-label={`Select ${code}`}
                        checked={selected.has(requirement.id)}
                        onChange={() => toggleSelected(requirement.id)}
                        className={CHECKBOX}
                      />
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => toggleExpanded(requirement.id)}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                      >
                        <ChevronRight
                          aria-hidden
                          className={cn(
                            "size-3.5 shrink-0 text-slate-400 transition-transform",
                            open && "rotate-90",
                          )}
                        />
                        <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-400">
                          {code}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">
                          {requirement.title}
                        </span>
                      </button>

                      <div className="flex shrink-0 basis-full items-center gap-1.5 pl-9 sm:basis-auto sm:pl-0">
                        {warnings.map((warning) => (
                          <span
                            key={warning}
                            className="inline-flex items-center rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800"
                          >
                            {warning}
                          </span>
                        ))}
                        <span
                          className={cn(
                            "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium",
                            PRIORITY_STYLE[requirement.priority],
                          )}
                        >
                          {requirement.priority}
                        </span>
                        <Badge tone={STATUS_TONE[requirement.status]}>
                          {label(requirement.status)}
                        </Badge>
                      </div>
                    </div>

                    {open ? (
                      <div className="border-t border-slate-100 bg-slate-50/50 px-3 py-3 pl-12">
                        <DescriptionList labelWidth="8rem">
                          <Field name="Description">
                            {requirement.description ? (
                              <p className="max-w-3xl text-pretty">
                                {requirement.description}
                              </p>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </Field>

                          <Field name="Acceptance">
                            {requirement.acceptanceCriteria ? (
                              <p className="max-w-3xl text-pretty">
                                {requirement.acceptanceCriteria}
                              </p>
                            ) : requirement.status === "approved" ? (
                              <span className="text-amber-700">
                                None recorded — there is nothing to verify this
                                against.
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </Field>

                          {requirement.assumptions ? (
                            <Field name="Assumptions">
                              <p className="max-w-3xl text-pretty">
                                {requirement.assumptions}
                              </p>
                            </Field>
                          ) : null}

                          <Field name="Classification">
                            <span className="text-slate-600">
                              {label(requirement.type)} · confidence{" "}
                              <span
                                className={cn(
                                  requirement.confidence === "low" &&
                                    "font-medium text-amber-700",
                                )}
                              >
                                {requirement.confidence}
                              </span>{" "}
                              ·{" "}
                              {requirement.source === "manual"
                                ? "entered by hand"
                                : "AI suggested"}
                              {requirement.stakeholder
                                ? ` · owner ${requirement.stakeholder}`
                                : ""}
                            </span>
                          </Field>

                          {deliveryEnabled ? (
                          <>
                          <Field name="Delivery">
                            <LinkEditor
                              noun="task"
                              code={code}
                              busy={busy}
                              links={links.map((link) => ({
                                id: link.id,
                                targetId: link.task?.id ?? "",
                                label: link.task?.title ?? "",
                                done: link.task?.status.category === "done",
                              }))}
                              options={taskOptions.map((task) => ({
                                id: task.id,
                                label: task.title,
                              }))}
                              empty={
                                isUncovered(requirement) ? (
                                  <span className="text-red-700">
                                    No delivery task — this approved requirement
                                    is uncovered.
                                  </span>
                                ) : (
                                  "No linked task yet."
                                )
                              }
                              onLink={(targetId) =>
                                link(requirement, "task", targetId)
                              }
                              onUnlink={(linkId) => unlink(requirement, linkId)}
                            />
                          </Field>

                          <Field name="Milestones">
                            <LinkEditor
                              noun="milestone"
                              code={code}
                              busy={busy}
                              links={requirement.links
                                .filter((item) => item.milestone)
                                .map((item) => ({
                                  id: item.id,
                                  targetId: item.milestone!.id,
                                  label: item.milestone!.title,
                                  done: item.milestone!.status === "completed",
                                }))}
                              options={milestoneOptions}
                              empty="None"
                              onLink={(targetId) =>
                                link(requirement, "milestone", targetId)
                              }
                              onUnlink={(linkId) => unlink(requirement, linkId)}
                            />
                          </Field>

                          <Field name="Risks">
                            <LinkEditor
                              noun="risk"
                              code={code}
                              busy={busy}
                              links={requirement.links
                                .filter((item) => item.risk)
                                .map((item) => ({
                                  id: item.id,
                                  targetId: item.risk!.id,
                                  label: item.risk!.description,
                                  done: false,
                                }))}
                              options={riskOptions}
                              empty="None"
                              onLink={(targetId) =>
                                link(requirement, "risk", targetId)
                              }
                              onUnlink={(linkId) => unlink(requirement, linkId)}
                            />
                          </Field>

                          </>
                          ) : null}

                          {requirement.citations.length > 0 ? (
                            <Field name="Evidence">
                              <ul className="space-y-1.5">
                                {requirement.citations.map((citation) => (
                                  <li key={citation.id}>
                                    <a
                                      href={`/documents/${citation.chunk.document.id}`}
                                      className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 hover:underline"
                                    >
                                      <FileText className="size-3 shrink-0 text-slate-400" />
                                      {citation.chunk.document.originalFilename}
                                      {citation.chunk.pageNumber
                                        ? ` · p.${citation.chunk.pageNumber}`
                                        : ""}
                                      {citation.chunk.sectionTitle
                                        ? ` · ${citation.chunk.sectionTitle}`
                                        : ""}
                                    </a>
                                    {citation.excerpt ? (
                                      <p className="mt-0.5 max-w-3xl border-l-2 border-slate-200 pl-2 text-xs text-slate-500 italic">
                                        {citation.excerpt}
                                      </p>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                            </Field>
                          ) : null}
                        </DescriptionList>

                        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
                          <Select
                            aria-label={`Status for ${code}`}
                            className="h-8 text-xs"
                            value={requirement.status}
                            disabled={busy}
                            onChange={(event) =>
                              void changeStatus(
                                requirement,
                                event.target.value as RequirementStatus,
                              )
                            }
                          >
                            {STATUSES.map((status) => (
                              <option key={status.value} value={status.value}>
                                {status.label}
                              </option>
                            ))}
                          </Select>
                          {busy ? <Spinner className="size-4" /> : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => startEdit(requirement)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="ml-auto text-slate-400 hover:bg-red-50 hover:text-red-700"
                            disabled={busy}
                            onClick={() => void remove(requirement)}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            </>
          )}
          </>
          )}
        </div>
      )}
    </div>
  );
}
