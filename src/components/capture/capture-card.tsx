"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Flag,
  ListPlus,
  MessageSquareText,
  RefreshCw,
  Trash2,
  Undo2,
} from "lucide-react";
import { useConfirm } from "@/components/confirm-dialog";
import { useLocale, useT } from "@/components/i18n-provider";
import { PRIORITY_FLAG } from "@/components/task-types";
import { useToast } from "@/components/toast";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  FOCUS_RING,
  Input,
  QUIET_CONTROL,
  ROW_LABEL,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import type { ProposalOverrides } from "@/lib/capture/schemas";
import type { CaptureProposalView, CaptureView } from "@/lib/capture/view";
import { intlLocale } from "@/lib/i18n/locales";
import type { Translate } from "@/lib/i18n/translate";
import { cn, formatDay } from "@/lib/utils";

export interface ProjectOption {
  id: string;
  name: string;
  personal: boolean;
}

type Priority = "low" | "medium" | "high" | "urgent";
const PRIORITIES: Priority[] = ["urgent", "high", "medium", "low"];
const STATUS_KEY = {
  done: "capture.statusDone",
  blocked: "capture.statusBlocked",
  open: "capture.statusOpen",
} as const;
const KIND_ICON = {
  create_task: ListPlus,
  update_task: RefreshCw,
  add_note: MessageSquareText,
} as const;
const KIND_KEY = {
  create_task: "capture.kindCreate",
  update_task: "capture.kindUpdate",
  add_note: "capture.kindNote",
} as const;
const SOURCE_KEY = {
  text: "capture.sourceText",
  voice: "capture.sourceVoice",
  document: "capture.sourceDocument",
  email: "capture.sourceEmail",
} as const;

/** The values a row shows: the model's proposal with the person's edits on top. */
function effective(proposal: CaptureProposalView, draft: ProposalOverrides) {
  switch (proposal.kind) {
    case "create_task":
      return {
        title: draft.title ?? proposal.payload.title,
        projectId: draft.projectId ?? proposal.payload.projectId,
        dueDate: draft.dueDate !== undefined ? draft.dueDate : proposal.payload.dueDate,
        priority: draft.priority !== undefined ? draft.priority : proposal.payload.priority,
        status: null,
        note: null,
      };
    case "update_task":
      return {
        title: proposal.task?.title ?? "",
        projectId: proposal.task?.projectId ?? null,
        dueDate: draft.dueDate !== undefined ? draft.dueDate : proposal.payload.dueDate,
        priority: draft.priority !== undefined ? draft.priority : proposal.payload.priority,
        status: draft.status !== undefined ? draft.status : proposal.payload.status,
        note: null,
      };
    case "add_note":
      return {
        title: proposal.task?.title ?? "",
        projectId: proposal.task?.projectId ?? null,
        dueDate: null,
        priority: null,
        status: null,
        note: draft.note ?? proposal.payload.note,
      };
  }
}

/**
 * One captured note and the changes it suggests.
 *
 * House pattern: one line per suggestion — what it does, where, and when —
 * with exceptions badged (a possible duplicate, a date to check) rather than
 * every field. Expanding a row shows its editable fields and the lines of the
 * note it rests on, so a suggestion can be checked against what was actually
 * said before it is applied.
 */
export function CaptureCard({
  capture,
  projects,
  onChange,
  onDelete,
}: {
  capture: CaptureView;
  projects: ProjectOption[];
  onChange: (capture: CaptureView) => void;
  onDelete: (captureId: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ProposalOverrides>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [showNote, setShowNote] = useState(false);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const dateLocale = intlLocale(locale);
  const pending = capture.proposals.filter((proposal) => proposal.state === "pending");
  const unflagged = pending.filter((proposal) => proposal.flags.length === 0);
  const projectName = (id: string | null) =>
    id ? (projects.find((project) => project.id === id)?.name ?? "") : t("capture.personalProject");

  async function apply(ids: string[]) {
    setBusy(ids.length === 1 ? ids[0] : "all");
    setRowErrors({});
    try {
      const response = await fetch(`/api/captures/${capture.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: ids.map((proposalId) => ({ proposalId, overrides: drafts[proposalId] })),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(t("capture.applyFailed", { error: data.error ?? response.status }));
        return;
      }
      if (data.capture) onChange(data.capture as CaptureView);

      const results = (data.results ?? []) as { proposalId: string; ok: boolean; error?: string }[];
      const failed = results.filter((result) => !result.ok);
      const done = results.length - failed.length;
      if (done > 0) {
        toast.success(t("capture.appliedCount", { count: done }));
        // Applied tasks change what server-rendered pages around this card
        // show (Today's buckets); the card's own state survives a refresh.
        router.refresh();
      }
      if (failed.length > 0) {
        toast.error(t("capture.someFailed", { count: failed.length }));
        setRowErrors(
          Object.fromEntries(failed.map((result) => [result.proposalId, result.error ?? ""])),
        );
      }
    } catch {
      toast.error(t("common.couldNotReach"));
    } finally {
      setBusy(null);
    }
  }

  async function decide(proposal: CaptureProposalView, state: "dismissed" | "pending") {
    setBusy(proposal.id);
    try {
      const response = await fetch(`/api/capture-proposals/${proposal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      });
      if (response.ok) {
        onChange({
          ...capture,
          proposals: capture.proposals.map((row) =>
            row.id === proposal.id ? { ...row, state } : row,
          ),
        });
      }
    } catch {
      toast.error(t("common.couldNotReach"));
    } finally {
      setBusy(null);
    }
  }

  async function retry() {
    setBusy("retry");
    try {
      const response = await fetch(`/api/captures/${capture.id}/retry`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (data.capture) onChange(data.capture as CaptureView);
      else toast.error(data.error ?? t("capture.sendFailed"));
    } catch {
      toast.error(t("common.couldNotReach"));
    } finally {
      setBusy(null);
    }
  }

  async function saveAsDocument() {
    const ok = await confirm({
      title: t("capture.saveTitle"),
      body: t("capture.saveBody"),
      confirmLabel: t("capture.saveAsDocument"),
    });
    if (!ok) return;
    setBusy("save");
    try {
      const response = await fetch(`/api/captures/${capture.id}/save-document`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.documentId) {
        toast.error(t("capture.saveDocumentFailed"), data.error);
        return;
      }
      onChange({ ...capture, documentId: data.documentId });
      toast.success(t("capture.savedToast"));
    } catch {
      toast.error(t("common.couldNotReach"));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: t("capture.deleteTitle"),
      body: t("capture.deleteBody"),
      confirmLabel: t("capture.delete"),
      tone: "danger",
    });
    if (!ok) return;
    const response = await fetch(`/api/captures/${capture.id}`, { method: "DELETE" });
    if (response.ok || response.status === 404) onDelete(capture.id);
    else toast.error(t("common.couldNotReach"));
  }

  const sourceLabel =
    capture.source === "document"
      ? t(SOURCE_KEY.document, { name: capture.documentName ?? "" })
      : t(SOURCE_KEY[capture.source]);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-2.5">
        <span className="text-xs text-slate-500">
          {/* The capture's own calendar day, UTC-pinned: a clock time here
              would render in the server's zone, then the browser's. */}
          {formatDay(capture.localDate, dateLocale)}
          <span className="mx-1.5 text-slate-300">·</span>
          {sourceLabel}
        </span>
        {pending.length > 0 ? (
          <Badge tone="info">{t("capture.pendingCount", { count: pending.length })}</Badge>
        ) : null}
        <span className="flex-1" />
        {capture.source === "email" ? (
          <Link
            href={`/email?capture=${capture.id}`}
            className="text-xs font-medium text-slate-500 hover:text-slate-900"
          >
            {t("capture.replyToEmail")}
          </Link>
        ) : null}
        {capture.documentId ? (
          <Link
            href={`/documents/${capture.documentId}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900"
          >
            <FileText className="size-3.5" aria-hidden />
            {t("capture.openDocument")}
          </Link>
        ) : capture.status !== "processing" ? (
          <button
            type="button"
            disabled={busy === "save"}
            onClick={() => void saveAsDocument()}
            className={cn("text-xs font-medium text-slate-500 hover:text-slate-900 disabled:opacity-50", FOCUS_RING)}
          >
            {t("capture.saveAsDocument")}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setShowNote(!showNote)}
          aria-expanded={showNote}
          className={cn("text-xs font-medium text-slate-500 hover:text-slate-900", FOCUS_RING)}
        >
          {showNote ? t("capture.hideNote") : t("capture.showNote")}
        </button>
        <button
          type="button"
          onClick={() => void remove()}
          title={t("capture.delete")}
          className={cn("rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-700", FOCUS_RING)}
        >
          <Trash2 className="size-3.5" aria-hidden />
          <span className="sr-only">{t("capture.delete")}</span>
        </button>
      </div>

      {showNote ? (
        <p className="border-b border-slate-100 bg-slate-50 px-4 py-3 text-sm whitespace-pre-wrap text-slate-700">
          {capture.body}
        </p>
      ) : null}

      {capture.status === "failed" ? (
        <div className="space-y-3 p-4">
          <ErrorState message={`${t("capture.failedTitle")}: ${capture.errorMessage ?? ""}`} />
          <Button type="button" size="sm" disabled={busy === "retry"} onClick={() => void retry()}>
            {busy === "retry" ? <Spinner className="border-white/40 border-t-white" /> : null}
            {t("capture.retry")}
          </Button>
        </div>
      ) : capture.status === "processing" ? (
        <p className="flex items-center gap-2 p-4 text-sm text-slate-500">
          <Spinner /> {t("capture.submitting")}
        </p>
      ) : capture.proposals.length === 0 ? (
        <p className="p-4 text-sm text-slate-500">{t("capture.noSuggestions")}</p>
      ) : (
        <>
          {unflagged.length > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
              <span className="text-xs text-slate-500">
                {unflagged.length < pending.length ? t("capture.applyAllHint") : null}
              </span>
              <Button
                type="button"
                size="sm"
                disabled={busy !== null}
                onClick={() => void apply(unflagged.map((proposal) => proposal.id))}
              >
                {busy === "all" ? <Spinner className="border-white/40 border-t-white" /> : null}
                {t("capture.applyAll", { count: unflagged.length })}
              </Button>
            </div>
          ) : null}
          <ul className="divide-y divide-slate-100">
            {capture.proposals.map((proposal) => (
              <ProposalRow
                key={proposal.id}
                proposal={proposal}
                draft={drafts[proposal.id] ?? {}}
                onDraft={(change) =>
                  setDrafts((current) => ({
                    ...current,
                    [proposal.id]: { ...current[proposal.id], ...change },
                  }))
                }
                expanded={expanded === proposal.id}
                onToggle={() => setExpanded(expanded === proposal.id ? null : proposal.id)}
                busy={busy === proposal.id || busy === "all"}
                error={rowErrors[proposal.id]}
                onApply={() => void apply([proposal.id])}
                onDismiss={() => void decide(proposal, "dismissed")}
                onRestore={() => void decide(proposal, "pending")}
                projects={projects}
                projectName={projectName}
                dateLocale={dateLocale}
                t={t}
              />
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function ProposalRow({
  proposal,
  draft,
  onDraft,
  expanded,
  onToggle,
  busy,
  error,
  onApply,
  onDismiss,
  onRestore,
  projects,
  projectName,
  dateLocale,
  t,
}: {
  proposal: CaptureProposalView;
  draft: ProposalOverrides;
  onDraft: (change: ProposalOverrides) => void;
  expanded: boolean;
  onToggle: () => void;
  busy: boolean;
  error?: string;
  onApply: () => void;
  onDismiss: () => void;
  onRestore: () => void;
  projects: ProjectOption[];
  projectName: (id: string | null) => string;
  dateLocale: string;
  t: Translate;
}) {
  const ids = useId();
  const values = effective(proposal, draft);
  // The personal project is the select's empty option, so it is chosen by
  // default and never listed twice.
  const personalId = projects.find((project) => project.personal)?.id;
  const Icon = KIND_ICON[proposal.kind];
  const decided = proposal.state !== "pending";
  const duePhrase =
    proposal.kind !== "add_note" && draft.dueDate === undefined ? proposal.payload.duePhrase : null;

  const changes: string[] = [];
  if (values.status) changes.push(t(STATUS_KEY[values.status]));
  if (values.dueDate) {
    const date = formatDay(values.dueDate, dateLocale);
    changes.push(duePhrase ? t("capture.duePhrase", { phrase: duePhrase, date }) : t("capture.dueOn", { date }));
  }
  if (proposal.kind === "update_task" && values.priority) {
    changes.push(t("capture.priorityTo", { level: t(`priority.${values.priority}`) }));
  }

  const headline =
    proposal.kind === "create_task"
      ? values.title
      : proposal.kind === "add_note"
        ? `${values.title} — ${values.note}`
        : values.title;

  return (
    <li className={cn(decided && "bg-slate-50/60")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 sm:flex-nowrap">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={`${ids}-detail`}
          title={t("capture.edit")}
          className={cn("shrink-0 rounded text-slate-400 hover:text-slate-900", FOCUS_RING)}
        >
          {expanded ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
          <span className="sr-only">{t("capture.edit")}</span>
        </button>
        <span title={t(KIND_KEY[proposal.kind])} className="shrink-0 text-slate-400">
          <Icon className="size-4" aria-hidden />
          <span className="sr-only">{t(KIND_KEY[proposal.kind])}</span>
        </span>
        {proposal.kind === "create_task" && values.priority ? (
          <span className="shrink-0" title={t("priority.flag", { level: t(`priority.${values.priority}`) })}>
            <Flag aria-hidden fill="currentColor" className={cn("size-3.5", PRIORITY_FLAG[values.priority])} />
            <span className="sr-only">{t("priority.flag", { level: t(`priority.${values.priority}`) })}</span>
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-sm font-medium", decided ? "text-slate-500" : "text-slate-900")}>
            {headline}
          </p>
          <p className="truncate text-xs text-slate-500">
            {[...changes, projectName(values.projectId)].filter(Boolean).join(" · ")}
          </p>
        </div>
        {proposal.flags.includes("possible_duplicate") ? (
          <Badge tone="warning">{t("capture.flagDuplicate")}</Badge>
        ) : null}
        {proposal.flags.includes("date_check") ? <Badge tone="warning">{t("capture.flagDate")}</Badge> : null}

        <div className="flex shrink-0 items-center gap-1.5">
          {proposal.state === "pending" ? (
            <>
              <Button type="button" size="sm" disabled={busy} onClick={onApply}>
                {busy ? <Spinner className="border-white/40 border-t-white" /> : null}
                {t("capture.apply")}
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onDismiss}>
                {t("capture.dismiss")}
              </Button>
            </>
          ) : proposal.state === "applied" ? (
            <>
              <Badge tone="success">{t("capture.applied")}</Badge>
              {proposal.appliedTaskId && proposal.appliedTaskProjectId ? (
                <Link
                  href={`/projects/${proposal.appliedTaskProjectId}/tasks?task=${proposal.appliedTaskId}`}
                  className="text-xs font-medium text-slate-600 underline-offset-2 hover:underline"
                >
                  {t("capture.openTask")}
                </Link>
              ) : null}
            </>
          ) : (
            <>
              <Badge tone="neutral">{t("capture.dismissed")}</Badge>
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onRestore}>
                <Undo2 className="size-3.5" aria-hidden />
                {t("capture.restore")}
              </Button>
            </>
          )}
        </div>
      </div>
      {error ? <p className="px-4 pb-2 text-xs text-red-700">{error}</p> : null}

      {expanded ? (
        <div id={`${ids}-detail`} className="space-y-3 border-t border-slate-100 bg-slate-50/50 px-4 py-3 sm:pl-12">
          {proposal.kind === "create_task" ? (
            <>
              <FieldRow label={t("capture.fieldTitle")} id={`${ids}-title`}>
                <Input
                  id={`${ids}-title`}
                  value={values.title}
                  maxLength={200}
                  disabled={decided}
                  onChange={(event) => onDraft({ title: event.target.value })}
                  className="h-9"
                />
              </FieldRow>
              <FieldRow label={t("capture.fieldProject")} id={`${ids}-project`}>
                <Select
                  id={`${ids}-project`}
                  value={values.projectId && values.projectId !== personalId ? values.projectId : ""}
                  disabled={decided}
                  onChange={(event) => onDraft({ projectId: event.target.value || personalId })}
                  className={cn(QUIET_CONTROL, "h-9")}
                >
                  <option value="">{t("capture.personalProject")}</option>
                  {projects
                    .filter((project) => !project.personal)
                    .map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                </Select>
              </FieldRow>
            </>
          ) : null}

          {proposal.kind === "update_task" ? (
            <FieldRow label={t("capture.fieldStatus")} id={`${ids}-status`}>
              <Select
                id={`${ids}-status`}
                value={values.status ?? ""}
                disabled={decided}
                onChange={(event) =>
                  onDraft({ status: (event.target.value || null) as ProposalOverrides["status"] })
                }
                className={cn(QUIET_CONTROL, "h-9")}
              >
                <option value="">{t("capture.noChange")}</option>
                {(Object.keys(STATUS_KEY) as (keyof typeof STATUS_KEY)[]).map((status) => (
                  <option key={status} value={status}>
                    {t(STATUS_KEY[status])}
                  </option>
                ))}
              </Select>
            </FieldRow>
          ) : null}

          {proposal.kind !== "add_note" ? (
            <>
              <FieldRow label={t("capture.fieldDue")} id={`${ids}-due`}>
                <Input
                  id={`${ids}-due`}
                  type="date"
                  value={values.dueDate ?? ""}
                  disabled={decided}
                  onChange={(event) => onDraft({ dueDate: event.target.value || null })}
                  className="h-9 w-auto"
                />
              </FieldRow>
              <FieldRow label={t("capture.fieldPriority")} id={`${ids}-priority`}>
                <Select
                  id={`${ids}-priority`}
                  value={values.priority ?? ""}
                  disabled={decided}
                  onChange={(event) => onDraft({ priority: (event.target.value || null) as Priority | null })}
                  className={cn(QUIET_CONTROL, "h-9")}
                >
                  <option value="">
                    {proposal.kind === "update_task" ? t("capture.noChange") : t("capture.notSet")}
                  </option>
                  {PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {t(`priority.${priority}`)}
                    </option>
                  ))}
                </Select>
              </FieldRow>
            </>
          ) : (
            <FieldRow label={t("capture.fieldNote")} id={`${ids}-note`}>
              <Textarea
                id={`${ids}-note`}
                value={values.note ?? ""}
                rows={2}
                maxLength={4000}
                disabled={decided}
                onChange={(event) => onDraft({ note: event.target.value })}
              />
            </FieldRow>
          )}

          <div>
            <p className={ROW_LABEL}>{t("capture.sources")}</p>
            <ul className="mt-1 space-y-1">
              {proposal.citations.map((citation) => (
                <li key={citation.label} className="text-sm text-slate-700">
                  <span className="mr-1.5 font-mono text-xs text-slate-400">{citation.label}</span>
                  <Highlighted text={citation.text} phrase={duePhrase} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function FieldRow({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[6rem_minmax(0,24rem)] sm:items-center sm:gap-3">
      <label htmlFor={id} className={ROW_LABEL}>
        {label}
      </label>
      {children}
    </div>
  );
}

/** Marks the date words inside a cited line, so the date can be checked where it was said. */
function Highlighted({ text, phrase }: { text: string; phrase: string | null }) {
  const at = phrase ? text.indexOf(phrase) : -1;
  if (!phrase || at === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded bg-amber-100 px-0.5 text-amber-900">{phrase}</mark>
      {text.slice(at + phrase.length)}
    </>
  );
}
