"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  ListPlus,
  MessageSquareText,
  Paperclip,
  RefreshCw,
  Sparkles,
  Undo2,
} from "lucide-react";
import { useLocale, useT } from "@/components/i18n-provider";
import { PriorityBadge } from "@/components/priority-badge";
import { useToast } from "@/components/toast";
import {
  Badge,
  Button,
  FOCUS_RING,
  Input,
  QUIET_CONTROL,
  ROW_LABEL,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import type { ProposalOverrides } from "@/lib/capture/schemas";
import type { CaptureProposalView } from "@/lib/capture/view";
import { intlLocale } from "@/lib/i18n/locales";
import type { Translate } from "@/lib/i18n/translate";
import { cn, formatDay } from "@/lib/utils";

export interface ProjectOption {
  id: string;
  name: string;
  personal: boolean;
}

/** A workspace member other than the viewer, who a new task can be handed to. */
export interface ColleagueOption {
  id: string;
  name: string;
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
/** The values a row shows: the model's proposal with the person's edits on top. */
function effective(proposal: CaptureProposalView, draft: ProposalOverrides) {
  switch (proposal.kind) {
    case "create_task":
      return {
        title: draft.title ?? proposal.payload.title,
        description:
          draft.description !== undefined ? draft.description : proposal.payload.description,
        projectId: draft.projectId ?? proposal.payload.projectId,
        dueDate: draft.dueDate !== undefined ? draft.dueDate : proposal.payload.dueDate,
        priority: draft.priority !== undefined ? draft.priority : proposal.payload.priority,
        status: draft.status !== undefined ? draft.status : proposal.payload.status,
        note: null,
      };
    case "update_task":
      return {
        title: proposal.task?.title ?? "",
        description: null,
        projectId: proposal.task?.projectId ?? null,
        dueDate: draft.dueDate !== undefined ? draft.dueDate : proposal.payload.dueDate,
        priority: draft.priority !== undefined ? draft.priority : proposal.payload.priority,
        status: draft.status !== undefined ? draft.status : proposal.payload.status,
        note: null,
      };
    case "add_note":
      return {
        title: proposal.task?.title ?? "",
        description: null,
        projectId: proposal.task?.projectId ?? null,
        dueDate: null,
        priority: null,
        status: null,
        note: draft.note ?? proposal.payload.note,
      };
  }
}

/**
 * Proposed changes — from a capture or from the assistant — one line each.
 *
 * House pattern: one line per suggestion — what it does, where, and when —
 * with exceptions badged (a possible duplicate, a date to check) rather than
 * every field. Expanding a row shows its editable fields and the lines it
 * rests on, so a suggestion can be checked against what was actually said
 * before it is applied. Where proposals are stored is the caller's business:
 * it passes the apply and decide endpoints, and — for a capture — a way to
 * have the model redo one suggestion from the person's correction.
 */
export function ProposalList({
  proposals,
  projects,
  colleagues,
  applyUrl,
  decideUrl,
  readProposals,
  onChange,
  onRevise,
  notice,
  onApplied,
}: {
  proposals: CaptureProposalView[];
  projects: ProjectOption[];
  colleagues: ColleagueOption[];
  /** POST { items } → { results, … }. */
  applyUrl: string;
  decideUrl: (proposalId: string) => string;
  /** Pulls the updated proposals out of the apply response. */
  readProposals: (data: unknown) => CaptureProposalView[] | null;
  onChange: (proposals: CaptureProposalView[]) => void;
  /** Redoes one suggestion from what the person says is wrong; true once replaced. */
  onRevise?: (proposalId: string, instruction: string) => Promise<boolean>;
  /** Something Apply does besides writing the task, said before it is pressed. */
  notice?: string | null;
  /** The whole apply response, for a parent that shows more than the list. */
  onApplied?: (data: unknown) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ProposalOverrides>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const dateLocale = intlLocale(locale);
  const pending = proposals.filter((proposal) => proposal.state === "pending");
  const unflagged = pending.filter((proposal) => proposal.flags.length === 0);
  // The personal project reads the same whether the model named it or left it blank.
  const projectName = (id: string | null) => {
    const project = id ? projects.find((option) => option.id === id) : null;
    return !id || project?.personal ? t("capture.personalProject") : (project?.name ?? "");
  };

  async function apply(ids: string[]) {
    setBusy(ids.length === 1 ? ids[0] : "all");
    setRowErrors({});
    try {
      const response = await fetch(applyUrl, {
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
      const updated = readProposals(data);
      if (updated) onChange(updated);
      onApplied?.(data);

      const results = (data.results ?? []) as { proposalId: string; ok: boolean; error?: string }[];
      const failed = results.filter((result) => !result.ok);
      const done = results.length - failed.length;
      if (done > 0) {
        toast.success(t("capture.appliedCount", { count: done }));
        // Applied tasks change what server-rendered pages around this list
        // show (Today's buckets); the list's own state survives a refresh.
        router.refresh();
      }
      if (failed.length > 0) {
        toast.error(t("capture.someFailed", { count: failed.length }));
        setRowErrors(Object.fromEntries(failed.map((result) => [result.proposalId, result.error ?? ""])));
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
      const response = await fetch(decideUrl(proposal.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      });
      if (response.ok) {
        onChange(proposals.map((row) => (row.id === proposal.id ? { ...row, state } : row)));
      }
    } catch {
      toast.error(t("common.couldNotReach"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {unflagged.length > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sand-100 px-4 py-2">
          <span className="text-xs text-sand-500">
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
      {notice ? (
        <p className="flex items-start gap-1.5 border-b border-sand-100 bg-sand-50 px-4 py-2 text-xs text-sand-600">
          <Paperclip className="mt-0.5 size-3.5 shrink-0 text-sand-400" aria-hidden />
          {notice}
        </p>
      ) : null}
      <ul className="divide-y divide-sand-100">
        {proposals.map((proposal) => (
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
            onRevise={
              onRevise && proposal.state === "pending"
                ? (instruction) => onRevise(proposal.id, instruction)
                : undefined
            }
            projects={projects}
            colleagues={colleagues}
            projectName={projectName}
            dateLocale={dateLocale}
            t={t}
          />
        ))}
      </ul>
    </>
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
  onRevise,
  projects,
  colleagues,
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
  onRevise?: (instruction: string) => Promise<boolean>;
  projects: ProjectOption[];
  colleagues: ColleagueOption[];
  projectName: (id: string | null) => string;
  dateLocale: string;
  t: Translate;
}) {
  const ids = useId();
  const values = effective(proposal, draft);
  const [instruction, setInstruction] = useState("");
  const [revising, setRevising] = useState(false);
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
    <li className={cn(decided && "bg-sand-50/60")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 sm:flex-nowrap">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={`${ids}-detail`}
          title={t("capture.edit")}
          className={cn("shrink-0 rounded text-sand-400 hover:text-sand-900", FOCUS_RING)}
        >
          {expanded ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
          <span className="sr-only">{t("capture.edit")}</span>
        </button>
        <span title={t(KIND_KEY[proposal.kind])} className="shrink-0 text-sand-400">
          <Icon className="size-4" aria-hidden />
          <span className="sr-only">{t(KIND_KEY[proposal.kind])}</span>
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("flex min-w-0 items-center gap-2 text-sm font-medium", decided ? "text-sand-500" : "text-sand-900")}>
            <span className="truncate">{headline}</span>
            {proposal.kind === "create_task" && values.priority ? (
              <PriorityBadge priority={values.priority} />
            ) : null}
          </p>
          <p className="truncate text-xs text-sand-500">
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
                  className="text-xs font-medium text-sand-600 underline-offset-2 hover:underline"
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
        <div id={`${ids}-detail`} className="space-y-3 border-t border-sand-100 bg-sand-50/50 px-4 py-3 sm:pl-12">
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
              <FieldRow label={t("capture.fieldDescription")} id={`${ids}-description`}>
                <Textarea
                  id={`${ids}-description`}
                  value={values.description ?? ""}
                  rows={3}
                  maxLength={4000}
                  disabled={decided}
                  onChange={(event) => onDraft({ description: event.target.value || null })}
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
              {colleagues.length > 0 ? (
                <FieldRow label={t("capture.fieldAssignee")} id={`${ids}-assignee`}>
                  <Select
                    id={`${ids}-assignee`}
                    value={draft.assigneeId ?? ""}
                    disabled={decided}
                    onChange={(event) => onDraft({ assigneeId: event.target.value || undefined })}
                    className={cn(QUIET_CONTROL, "h-9")}
                  >
                    <option value="">{t("capture.assigneeMe")}</option>
                    {colleagues.map((colleague) => (
                      <option key={colleague.id} value={colleague.id}>
                        {colleague.name}
                      </option>
                    ))}
                  </Select>
                </FieldRow>
              ) : null}
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
                  {/* Priority is only read from words like 急 or 唔急; with none, a
                      new task is saved at medium, and the option says so. */}
                  <option value="">
                    {proposal.kind === "update_task"
                      ? t("capture.noChange")
                      : t("capture.priorityDefault")}
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
                <li key={citation.label} className="text-sm text-sand-700">
                  <span className="mr-1.5 font-mono text-xs text-sand-400">{citation.label}</span>
                  <Highlighted text={citation.text} phrase={duePhrase} />
                </li>
              ))}
            </ul>
          </div>

          {onRevise ? (
            <form
              className="space-y-2 border-t border-sand-100 pt-3"
              onSubmit={async (event) => {
                event.preventDefault();
                if (instruction.trim().length < 2) return;
                setRevising(true);
                const replaced = await onRevise(instruction.trim());
                // A replaced row unmounts; only a failed one keeps its text.
                if (!replaced) setRevising(false);
              }}
            >
              <label htmlFor={`${ids}-revise`} className={ROW_LABEL}>
                {t("capture.reviseLabel")}
              </label>
              <Textarea
                id={`${ids}-revise`}
                value={instruction}
                rows={2}
                maxLength={500}
                disabled={revising}
                placeholder={t("capture.revisePlaceholder")}
                onChange={(event) => setInstruction(event.target.value)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  disabled={revising || instruction.trim().length < 2}
                >
                  {revising ? <Spinner /> : <Sparkles className="size-3.5" aria-hidden />}
                  {revising ? t("capture.revising") : t("capture.revise")}
                </Button>
                <span className="text-xs text-sand-500">{t("capture.reviseHint")}</span>
              </div>
            </form>
          ) : null}
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
