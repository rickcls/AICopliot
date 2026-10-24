"use client";

import { requirementStatusHint, requirementStatusLabel } from "@/lib/pm/labels";
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
  Paperclip,
  Sparkles,
} from "lucide-react";
import { UPLOAD_EXTENSIONS, asUploadable, mailFileErrorKey } from "@/lib/mail/document";
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
  FilterChip,
  FOCUS_RING,
  Input,
  SearchField,
  SectionHeader,
  Segment,
  SegmentedControl,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
import { useT } from "@/components/i18n-provider";
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

// Labels come from the dictionaries (`requirementType`, `requirementStatus`,
// …) so the register, matrix, exports, and overview all call a value the same
// thing.
const TYPES: RequirementType[] = ["business", "functional", "non_functional", "constraint"];
const PRIORITIES: RequirementPriority[] = ["must", "should", "could", "wont"];
const STATUSES: RequirementStatus[] = [
  "draft",
  "needs_clarification",
  "validated",
  "approved",
  "rejected",
];
const CONFIDENCES: RequirementConfidence[] = ["high", "medium", "low"];

const STATUS_TONE = {
  draft: "neutral",
  needs_clarification: "warning",
  validated: "info",
  approved: "success",
  rejected: "danger",
} as const;

const STATUS_DOT = {
  draft: "bg-sand-400",
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
  must: "bg-sand-900 text-white",
  should: "bg-sand-100 text-sand-700",
  could: "bg-sand-50 text-sand-500",
  wont: "bg-sand-50 text-sand-400 line-through",
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
type Warning = "noTask" | "noCriteria" | "lowConfidence";

function warningsFor(
  requirement: RequirementRow,
  deliveryEnabled: boolean,
): Warning[] {
  const warnings: Warning[] = [];
  // "No task" is only a gap when this project tracks delivery here; otherwise
  // it would badge every agreed requirement for work that lives elsewhere.
  if (deliveryEnabled && isUncovered(requirement)) warnings.push("noTask");
  if (requirement.status === "approved" && !requirement.acceptanceCriteria) {
    warnings.push("noCriteria");
  }
  if (requirement.confidence === "low" && requirement.status !== "rejected") {
    warnings.push("lowConfidence");
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
  kind,
  code,
  links,
  options,
  empty,
  busy,
  onLink,
  onUnlink,
}: {
  kind: "task" | "milestone" | "risk";
  code: string;
  links: Array<{ id: string; targetId: string; label: string; done: boolean }>;
  options: LinkTargetOption[];
  empty: React.ReactNode;
  busy: boolean;
  onLink: (targetId: string) => Promise<void>;
  onUnlink: (linkId: string) => Promise<void>;
}) {
  const [picking, setPicking] = useState(false);
  const t = useT();
  const available = options.filter(
    (option) => !links.some((link) => link.targetId === option.id),
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {links.length === 0 ? (
        <span className="text-sand-400">{empty}</span>
      ) : (
        links.map((link) => (
          <span
            key={link.id}
            className="inline-flex max-w-full items-center gap-1 rounded-md border border-sand-200 bg-white px-2 py-0.5 text-xs text-sand-700"
          >
            {link.done ? (
              <Check
                className="size-3 shrink-0 text-emerald-600"
                aria-label={t("requirements.links.done")}
              />
            ) : null}
            <span className="min-w-0 truncate" title={link.label}>
              {link.label}
            </span>
            <button
              type="button"
              aria-label={t("requirements.links.unlink", { label: link.label })}
              className="text-sand-400 hover:text-red-700"
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
          aria-label={t(`requirements.links.pickLabel.${kind}`, { code })}
          className="h-7 max-w-xs py-0 text-xs"
          defaultValue=""
          disabled={busy}
          // The menu is open the moment the picker replaces the button, so a
          // keyboard user is not left on an element that just disappeared.
          defaultOpen
          onBlur={() => setPicking(false)}
          onChange={async (event) => {
            const targetId = event.target.value;
            if (!targetId) return;
            await onLink(targetId);
            setPicking(false);
          }}
        >
          <option value="">{t(`requirements.links.pickPlaceholder.${kind}`)}</option>
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
            options.length === 0 ? t(`requirements.links.noneYet.${kind}`) : undefined
          }
          onClick={() => setPicking(true)}
        >
          {t(`requirements.links.add.${kind}`)}
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
  const t = useT();
  const [bulkBusy, setBulkBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showExtract, setShowExtract] = useState(initialRequirements.length === 0);
  // Starts from the server's list and grows with uploads made here, so a
  // client brief can be added and extracted from without leaving the page.
  const [documents, setDocuments] = useState(readyDocuments);
  const [uploading, setUploading] = useState<string | null>(null);
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
        setError(data.error ?? t("requirements.saveFailed"));
        return;
      }
      upsert(data.requirement);
      setDraft(null);
      setEditingId(null);
    } catch {
      setError(t("common.couldNotReach"));
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
        setError(data.error ?? t("requirements.updateFailed"));
        return;
      }
      upsert(data.requirement);
      // A review transition can close out the run, so its badge must refresh.
      if (requirement.source === "ai_suggested") router.refresh();
    } catch {
      setError(t("common.couldNotReach"));
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
          t("requirements.bulkFailed", {
            failed: failed.length,
            total: results.length,
            reason: failed[0].data.error ?? t("requirements.bulkFailedReason"),
          }),
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
        setError(data.error ?? t(`requirements.links.failed.${targetType}`));
        return;
      }
      upsert(data.requirement);
    } catch {
      setError(t("common.couldNotReach"));
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
        setError(data.error ?? t("requirements.links.removeFailed"));
        return;
      }
      upsert(data.requirement);
    } catch {
      setError(t("common.couldNotReach"));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(requirement: RequirementRow) {
    const code = formatRequirementCode(requirement.sequence);
    const confirmed = await confirm({
      title: t("requirements.deleteTitle", { code }),
      body: <p className="italic">“{requirement.title}”</p>,
      confirmLabel: t("requirements.deleteConfirm"),
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
        setError(data.error ?? t("requirements.deleteFailed"));
        return;
      }
      setRequirements((previous) =>
        previous.filter((item) => item.id !== requirement.id),
      );
      toast.success(t("requirements.deleted", { code }));
    } catch {
      setError(t("common.couldNotReach"));
    } finally {
      setBusyId(null);
    }
  }

  /**
   * The ordinary upload route and indexing, then the document is selected.
   * Labelling runs afterwards and is not waited on: extraction reads the
   * indexed text, not the label.
   */
  async function uploadForExtraction(chosen: File) {
    setUploading(chosen.name);
    setError(null);
    try {
      // A client's email is a common brief; it is read here and uploaded as
      // its Markdown document, like every other uploader.
      let file: File;
      try {
        file = await asUploadable(chosen);
      } catch (caught) {
        const key = mailFileErrorKey(caught);
        setError(key ? t(key) : t("tasks.documents.uploadFailed"));
        return;
      }
      const formData = new FormData();
      formData.append("file", file);
      formData.append("projectId", projectId);
      const response = await fetch("/api/documents", { method: "POST", body: formData });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(
          data.error ??
            (response.status === 413 ? t("tasks.documents.tooLarge") : t("tasks.documents.uploadFailed")),
        );
        return;
      }
      const processed = await fetch(`/api/documents/${data.id}/process`, { method: "POST" })
        .then((result) => result.json())
        .catch(() => ({ status: "failed" }));
      if (processed.status !== "ready") {
        setError(
          t("requirements.extract.uploadFailed", {
            name: file.name,
            reason: processed.error ?? t("tasks.documents.uploadFailed"),
          }),
        );
        return;
      }
      void fetch(`/api/documents/${data.id}/label`, { method: "POST" }).catch(() => {});
      setDocuments((current) => [
        ...current,
        { id: data.id, originalFilename: file.name, chunkCount: processed.chunkCount ?? 0 },
      ]);
      setDocumentIds((current) =>
        current.size < MAX_DOCUMENTS ? new Set([...current, data.id]) : current,
      );
    } catch {
      setError(t("tasks.documents.uploadRetry"));
    } finally {
      setUploading(null);
    }
  }

  const uploadControl = (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <label
        className={buttonClasses({
          variant: "secondary",
          size: "sm",
          className: cn(
            "cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-sand-900",
            (uploading !== null || extracting) && "pointer-events-none opacity-50",
          ),
        })}
      >
        {uploading ? <Spinner className="size-3.5" /> : <Paperclip className="size-3.5" aria-hidden />}
        {t("requirements.extract.upload")}
        <input
          type="file"
          accept={UPLOAD_EXTENSIONS.join(",")}
          className="sr-only"
          disabled={uploading !== null || extracting}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void uploadForExtraction(file);
          }}
        />
      </label>
      <span className="text-xs text-sand-500">
        {uploading
          ? t("requirements.extract.uploading", { name: uploading })
          : t("requirements.extract.uploadHint")}
      </span>
    </span>
  );

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
        setError(data.error ?? t("requirements.extractFailed"));
        return;
      }
      router.refresh();
    } catch {
      setError(t("common.couldNotReach"));
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
    { value: "all", label: t("common.all"), count: requirements.length },
    ...STATUSES.map((status) => ({
      value: status as RegisterFilter,
      label: t(`requirementStatus.${status}`),
      count: requirements.filter((item) => item.status === status).length,
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
          className="flex w-full items-center gap-2.5 px-4 py-3 text-left hover:bg-sand-50"
        >
          <Sparkles className="size-4 shrink-0 text-sand-400" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-sand-900">
              {t("requirements.extract.title")}
            </span>
            <span className="block text-xs text-sand-500">
              {documents.length === 0
                ? t("requirements.extract.noDocuments")
                : t("requirements.extract.selected", {
                    selected: documentIds.size,
                    count: documents.length,
                  })}
              {activeRun ? ` · ${t("requirements.extract.awaiting")}` : ""}
            </span>
          </span>
          <ChevronRight
            className={cn(
              "size-4 shrink-0 text-sand-400 transition-transform",
              showExtract && "rotate-90",
            )}
          />
        </button>

        {showExtract ? (
          <div className="border-t border-sand-100 px-4 py-4">
            <p className="max-w-2xl text-sm text-sand-600">
              {t("requirements.extract.intro")}
              {requirements.length > 0
                ? ` ${t("requirements.extract.introExisting", { count: requirements.length })}`
                : null}
            </p>

            {documents.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  title={t("requirements.extract.emptyTitle")}
                  description={t("requirements.extract.emptyBody")}
                  action={
                    <span className="flex flex-col items-center gap-2">
                      {uploadControl}
                      <Link
                        className="text-sm font-medium text-blue-700 hover:underline"
                        href={`/projects/${projectId}/documents`}
                      >
                        {t("requirements.extract.openDocuments")}
                      </Link>
                    </span>
                  }
                />
              </div>
            ) : (
              <>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {documents.map((document) => (
                    <label
                      key={document.id}
                      className="flex cursor-pointer items-start gap-2 rounded-lg border border-sand-200 p-2.5 text-sm hover:border-sand-300"
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
                        className="mt-0.5 size-4 rounded border-sand-300"
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-sand-800">
                          {document.originalFilename}
                        </span>
                        <span className="text-xs text-sand-500">
                          {t("requirements.extract.chunks", { count: document.chunkCount })}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>

                <div className="mt-3">{uploadControl}</div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    onClick={() => void extract()}
                    disabled={
                      extracting ||
                      uploading !== null ||
                      Boolean(activeRun) ||
                      documentIds.size === 0 ||
                      documentIds.size > MAX_DOCUMENTS
                    }
                  >
                    {extracting ? (
                      <Spinner inverse />
                    ) : null}
                    {t("requirements.extract.run")}
                  </Button>
                  {activeRun ? (
                    <p className="text-xs text-amber-700">
                      {activeRun.status === "processing"
                        ? t("requirements.extract.running")
                        : t("requirements.extract.reviewFirst")}
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
        title={t("requirements.register.title")}
        description={
          <>
            {t("requirements.register.recorded", { count: requirements.length })} ·{" "}
            {/* "Every approved requirement is covered" reads as reassurance, so
                it must not be shown when nothing has been approved at all. */}
            {approvedCount === 0 ? (
              t("requirements.register.nothingAgreed")
            ) : !deliveryEnabled ? (
              t("requirements.register.agreed", { count: approvedCount })
            ) : uncoveredCount === 0 ? (
              t("requirements.register.allCovered", { count: approvedCount })
            ) : (
              <span className="font-medium text-red-700">
                {t("requirements.register.uncovered", {
                  uncovered: uncoveredCount,
                  agreed: approvedCount,
                })}
              </span>
            )}
          </>
        }
      >
        {deliveryEnabled ? (
        <SegmentedControl label={t("requirements.register.viewLabel")}>
          {(
            [
              ["register", t("requirements.register.viewRegister"), ListChecks],
              ["matrix", t("requirements.register.viewMatrix"), Grid3x3],
            ] as const
          ).map(([value, text, Icon]) => (
            <Segment
              key={value}
              pressed={view === value}
              onClick={() => setView(value)}
              className="px-2.5"
            >
              <Icon className="size-3.5" aria-hidden />
              {text}
            </Segment>
          ))}
        </SegmentedControl>
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
          {expanded.size > 0
            ? t("requirements.register.collapseAll")
            : t("requirements.register.expandAll")}
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
          {t("requirements.register.newRequirement")}
        </Button>
        {requirements.length > 0 ? (
          // The two packs are what goes to the client; they open as printable
          // pages (Save as PDF) with a Markdown download there too. The CSV is
          // the whole register for a spreadsheet. Plain anchors throughout:
          // the export route answers with Content-Disposition.
          <div
            className="flex flex-wrap items-center gap-1"
            role="group"
            aria-label={t("requirements.register.shareLabel")}
          >
            <Download className="size-3.5 text-sand-400" aria-hidden />
            <a
              href={`/print/requirements/${projectId}?pack=questions`}
              target="_blank"
              rel="noopener"
              className={buttonClasses({ variant: "ghost", size: "sm", className: "px-2" })}
            >
              {t("requirements.register.clientQuestions")}
            </a>
            <a
              href={`/print/requirements/${projectId}?pack=signoff`}
              target="_blank"
              rel="noopener"
              className={buttonClasses({ variant: "ghost", size: "sm", className: "px-2" })}
            >
              {t("requirements.register.signoff")}
            </a>
            <a
              href={`/api/projects/${projectId}/requirements/export?format=csv`}
              download
              aria-label={t("requirements.register.csvLabel")}
              className={buttonClasses({ variant: "ghost", size: "sm", className: "px-2" })}
            >
              {t("requirements.register.csv")}
            </a>
          </div>
        ) : null}
      </SectionHeader>

      {draft ? (
        <Card className="p-4">
          <form onSubmit={save} className="space-y-3">
            <p className="text-sm font-medium">
              {editingId ? t("requirements.form.editTitle") : t("requirements.form.newTitle")}
            </p>

            <div>
              <label
                htmlFor="requirement-title"
                className="mb-1.5 block text-sm font-medium"
              >
                {t("requirements.form.title")}
              </label>
              <Input
                id="requirement-title"
                value={draft.title}
                onChange={(event) =>
                  setDraft({ ...draft, title: event.target.value })
                }
                placeholder={t("requirements.form.titlePlaceholder")}
                maxLength={200}
                disabled={saving}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label
                  htmlFor="requirement-type"
                  className="mb-1 block text-xs text-sand-500"
                >
                  {t("requirements.form.type")}
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
                    <option key={type} value={type}>
                      {t(`requirementType.${type}`)}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label
                  htmlFor="requirement-priority"
                  className="mb-1 block text-xs text-sand-500"
                >
                  {t("requirements.form.priority")}
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
                    <option key={priority} value={priority}>
                      {t(`requirementPriority.${priority}`)}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label
                  htmlFor="requirement-status"
                  className="mb-1 block text-xs text-sand-500"
                >
                  {t("requirements.form.status")}
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
                    <option key={status} value={status}>
                      {t(`requirementStatus.${status}`)}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label
                  htmlFor="requirement-confidence"
                  className="mb-1 block text-xs text-sand-500"
                >
                  {t("requirements.form.confidence")}
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
                    <option key={confidence} value={confidence}>
                      {t(`confidence.${confidence}`)}
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
                {t("requirements.form.description")}{" "}
                <span className="font-normal text-sand-500">
                  {t("requirements.form.optional")}
                </span>
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
                {t("requirements.form.acceptance")}{" "}
                <span className="font-normal text-sand-500">
                  {t("requirements.form.acceptanceHint")}
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
                  {t("requirements.form.assumptions")}{" "}
                  <span className="font-normal text-sand-500">
                    {t("requirements.form.optional")}
                  </span>
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
                  {t("requirements.form.stakeholder")}{" "}
                  <span className="font-normal text-sand-500">
                    {t("requirements.form.optional")}
                  </span>
                </label>
                <Input
                  id="requirement-stakeholder"
                  value={draft.stakeholder}
                  onChange={(event) =>
                    setDraft({ ...draft, stakeholder: event.target.value })
                  }
                  placeholder={t("requirements.form.stakeholderPlaceholder")}
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
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={saving || !draft.title.trim()}>
                {saving ? (
                  <>
                    <Spinner inverse />
                    {t("common.saving")}
                  </>
                ) : editingId ? (
                  t("requirements.form.saveChanges")
                ) : (
                  t("requirements.form.create")
                )}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {requirements.length === 0 && !draft ? (
        <EmptyState
          title={t("requirements.empty.title")}
          description={t("requirements.empty.body")}
          action={
            <Button
              type="button"
              onClick={() => {
                setEditingId(null);
                setDraft({ ...EMPTY });
              }}
            >
              {t("requirements.empty.action")}
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-sand-200 bg-white shadow-sm">
          {/* Two groups with a wide gap rather than one row with a divider: a
              `w-px` separator dangles at the end of a wrapped line, and the Gaps
              chip orphaned onto its own row. Grouped, they wrap together. */}
          <div
            role="group"
            aria-label={t("requirements.filters.label")}
            className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-sand-200 bg-sand-50/60 px-3 py-2.5"
          >
            <div className="flex flex-wrap items-center gap-1.5">
            {statusFilters.map((entry) => {
              const selectedFilter = filter === entry.value;
              const dot =
                entry.value === "all"
                  ? null
                  : STATUS_DOT[entry.value as RequirementStatus];

              return (
                <FilterChip
                  key={entry.value}
                  pressed={selectedFilter}
                  count={entry.count}
                  onClick={() => setFilter(entry.value)}
                >
                  {dot ? (
                    <span aria-hidden className={cn("size-1.5 rounded-full", dot)} />
                  ) : null}
                  {entry.label}
                </FilterChip>
              );
            })}
            </div>

            {/* Gaps cuts across the lifecycle statuses rather than being one of
                them, so it is a separate group. */}
            {deliveryEnabled ? (
            <FilterChip
              tone="danger"
              pressed={filter === "gaps"}
              count={uncoveredCount}
              onClick={() => setFilter("gaps")}
            >
              {t("requirements.filters.gaps")}
            </FilterChip>
            ) : null}
          </div>

          <div
            role="search"
            aria-label={t("requirements.filters.searchRegion")}
            className="flex flex-wrap items-center gap-2 border-b border-sand-200 px-3 py-2"
          >
            <SearchField
              label={t("requirements.filters.search")}
              placeholder={t("requirements.filters.searchPlaceholder")}
              value={refine.query}
              onChange={(event) =>
                setRefine((previous) => ({ ...previous, query: event.target.value }))
              }
              className="w-full sm:w-72"
            />
            {(
              [
                [
                  "type",
                  t("requirements.filters.anyType"),
                  t("requirements.filters.byType"),
                  TYPES.map((value) => ({ value, label: t(`requirementType.${value}`) })),
                ],
                [
                  "priority",
                  t("requirements.filters.anyPriority"),
                  t("requirements.filters.byPriority"),
                  PRIORITIES.map((value) => ({
                    value,
                    label: t(`requirementPriority.${value}`),
                  })),
                ],
                [
                  "confidence",
                  t("requirements.filters.anyConfidence"),
                  t("requirements.filters.byConfidence"),
                  CONFIDENCES.map((value) => ({ value, label: t(`confidence.${value}`) })),
                ],
              ] as const
            ).map(([key, anyLabel, filterLabel, options]) => (
              <Select
                key={key}
                aria-label={filterLabel}
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
                {t("common.clear")}
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
            // A tinted band like the task list's, not a black one: the batch
            // is a selection, and selection is drawn in the brand tint.
            <div className="flex flex-wrap items-center gap-2 border-b border-brand-100 bg-brand-50 px-3 py-2 text-brand-900">
              <span className="text-xs font-semibold">
                {t("requirements.bulk.selected", { count: selectedVisible.length })}
              </span>
              {!allVisibleSelected ? (
                <button
                  type="button"
                  className={cn("rounded text-xs text-brand-700 underline underline-offset-2 hover:text-brand-900", FOCUS_RING)}
                  onClick={toggleSelectAll}
                >
                  {t("requirements.bulk.selectAll", { count: visible.length })}
                </button>
              ) : null}
              <span aria-hidden className="mx-1 h-4 w-px bg-brand-200" />
              {(
                [
                  ["approved", t("requirements.bulk.approve")],
                  ["validated", t("requirements.bulk.validate")],
                  ["needs_clarification", t("requirements.bulk.clarify")],
                  ["rejected", t("requirements.bulk.reject")],
                  // Without a way back, one mis-aimed batch approval could only
                  // be undone a row at a time. Undo belongs wherever bulk does.
                  ["draft", t("requirements.bulk.backToReview")],
                ] as Array<[RequirementStatus, string]>
              ).map(([status, text]) => (
                <button
                  key={status}
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => void applyBulkStatus(status)}
                  className={buttonClasses({ variant: "secondary", size: "sm", className: "h-7 px-2.5 text-xs" })}
                >
                  {text}
                </button>
              ))}
              {bulkBusy ? <Spinner /> : null}
              <button
                type="button"
                className={cn("ml-auto rounded text-xs text-brand-700 hover:text-brand-900", FOCUS_RING)}
                onClick={() => setSelected(new Set())}
              >
                {t("common.clear")}
              </button>
            </div>
          ) : null}

          {visible.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-sand-500">
              {refineActive
                ? t("requirements.list.noSearchMatch")
                : filter === "gaps"
                  ? t("requirements.list.noGaps")
                  : t("requirements.list.noneInStatus", {
                      status: requirementStatusLabel(filter, t),
                    })}
            </div>
          ) : (
            <>
            {/* Aligned with the row checkboxes so the column reads as a column. */}
            <div className="flex items-center gap-2 border-b border-sand-100 bg-sand-50/40 px-3 py-1.5">
              <input
                type="checkbox"
                aria-label={
                  allVisibleSelected
                    ? t("requirements.list.clearSelection")
                    : t("requirements.list.selectAllShown", { count: visible.length })
                }
                checked={allVisibleSelected}
                ref={(node) => {
                  // React has no `indeterminate` prop; the partial state has to
                  // be set on the DOM node directly.
                  if (node) node.indeterminate = someVisibleSelected;
                }}
                onChange={toggleSelectAll}
                className="size-4 shrink-0 rounded border-sand-300"
              />
              <span className="text-xs text-sand-500">
                {selectedVisible.length > 0
                  ? t("requirements.list.selectedOf", {
                      selected: selectedVisible.length,
                      count: visible.length,
                    })
                  : filter === "all" && !refineActive
                    ? t("requirements.list.shown", { count: visible.length })
                    : t("requirements.list.shownOf", {
                        count: visible.length,
                        total: requirements.length,
                      })}
              </span>
            </div>
            <ul className="divide-y divide-sand-100">
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
                        open ? "bg-sand-50" : "hover:bg-sand-50/70",
                      )}
                    >
                      <input
                        type="checkbox"
                        aria-label={t("requirements.list.select", { code })}
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
                            "size-3.5 shrink-0 text-sand-400 transition-transform",
                            open && "rotate-90",
                          )}
                        />
                        <span className="shrink-0 font-mono text-[11px] tabular-nums text-sand-400">
                          {code}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-sand-900">
                          {requirement.title}
                        </span>
                      </button>

                      <div className="flex shrink-0 basis-full items-center gap-1.5 pl-9 sm:basis-auto sm:pl-0">
                        {warnings.map((warning) => (
                          <Badge key={warning} tone="warning">
                            {t(`requirements.warnings.${warning}`)}
                          </Badge>
                        ))}
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
                            PRIORITY_STYLE[requirement.priority],
                          )}
                        >
                          {t(`requirementPriority.${requirement.priority}`)}
                        </span>
                        <Badge tone={STATUS_TONE[requirement.status]}>
                          <span title={requirementStatusHint(requirement.status, t)}>
                            {t(`requirementStatus.${requirement.status}`)}
                          </span>
                        </Badge>
                      </div>
                    </div>

                    {open ? (
                      <div className="border-t border-sand-100 bg-sand-50/50 px-3 py-3 pl-12">
                        <DescriptionList labelWidth="8rem">
                          <Field name={t("requirements.row.description")}>
                            {requirement.description ? (
                              <p className="max-w-3xl text-pretty">
                                {requirement.description}
                              </p>
                            ) : (
                              <span className="text-sand-400">—</span>
                            )}
                          </Field>

                          <Field name={t("requirements.row.acceptance")}>
                            {requirement.acceptanceCriteria ? (
                              <p className="max-w-3xl text-pretty">
                                {requirement.acceptanceCriteria}
                              </p>
                            ) : requirement.status === "approved" ? (
                              <span className="text-amber-700">
                                {t("requirements.row.noAcceptance")}
                              </span>
                            ) : (
                              <span className="text-sand-400">—</span>
                            )}
                          </Field>

                          {requirement.assumptions ? (
                            <Field name={t("requirements.row.assumptions")}>
                              <p className="max-w-3xl text-pretty">
                                {requirement.assumptions}
                              </p>
                            </Field>
                          ) : null}

                          <Field name={t("requirements.row.classification")}>
                            <span className="text-sand-600">
                              {t(`requirementType.${requirement.type}`)} ·{" "}
                              <span
                                className={cn(
                                  requirement.confidence === "low" &&
                                    "font-medium text-amber-700",
                                )}
                              >
                                {t("requirements.row.confidence", {
                                  level: t(`confidence.${requirement.confidence}`),
                                })}
                              </span>{" "}
                              ·{" "}
                              {requirement.source === "manual"
                                ? t("requirements.row.byHand")
                                : t("requirements.row.aiSuggested")}
                              {requirement.stakeholder
                                ? ` · ${t("requirements.row.owner", { name: requirement.stakeholder })}`
                                : ""}
                            </span>
                          </Field>

                          {deliveryEnabled ? (
                          <>
                          <Field name={t("requirements.row.delivery")}>
                            <LinkEditor
                              kind="task"
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
                                    {t("requirements.row.uncovered")}
                                  </span>
                                ) : (
                                  t("requirements.row.noTaskYet")
                                )
                              }
                              onLink={(targetId) =>
                                link(requirement, "task", targetId)
                              }
                              onUnlink={(linkId) => unlink(requirement, linkId)}
                            />
                          </Field>

                          <Field name={t("requirements.row.milestones")}>
                            <LinkEditor
                              kind="milestone"
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
                              empty={t("common.none")}
                              onLink={(targetId) =>
                                link(requirement, "milestone", targetId)
                              }
                              onUnlink={(linkId) => unlink(requirement, linkId)}
                            />
                          </Field>

                          <Field name={t("requirements.row.risks")}>
                            <LinkEditor
                              kind="risk"
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
                              empty={t("common.none")}
                              onLink={(targetId) =>
                                link(requirement, "risk", targetId)
                              }
                              onUnlink={(linkId) => unlink(requirement, linkId)}
                            />
                          </Field>

                          </>
                          ) : null}

                          {requirement.citations.length > 0 ? (
                            <Field name={t("requirements.row.evidence")}>
                              <ul className="space-y-1.5">
                                {requirement.citations.map((citation) => (
                                  <li key={citation.id}>
                                    <a
                                      href={`/documents/${citation.chunk.document.id}`}
                                      className="inline-flex items-center gap-1.5 text-xs font-medium text-sand-700 hover:text-sand-900 hover:underline"
                                    >
                                      <FileText className="size-3 shrink-0 text-sand-400" />
                                      {citation.chunk.document.originalFilename}
                                      {citation.chunk.pageNumber
                                        ? ` · ${t("common.page", { page: citation.chunk.pageNumber })}`
                                        : ""}
                                      {citation.chunk.sectionTitle
                                        ? ` · ${citation.chunk.sectionTitle}`
                                        : ""}
                                    </a>
                                    {citation.excerpt ? (
                                      <p className="mt-0.5 max-w-3xl border-l-2 border-sand-200 pl-2 text-xs text-sand-500 italic">
                                        {citation.excerpt}
                                      </p>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                            </Field>
                          ) : null}
                        </DescriptionList>

                        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-sand-200 pt-3">
                          <Select
                            aria-label={t("requirements.row.statusFor", { code })}
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
                              <option key={status} value={status}>
                                {t(`requirementStatus.${status}`)}
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
                            {t("requirements.row.edit")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="ml-auto text-sand-400 hover:bg-red-50 hover:text-red-700"
                            disabled={busy}
                            onClick={() => void remove(requirement)}
                          >
                            {t("common.delete")}
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
