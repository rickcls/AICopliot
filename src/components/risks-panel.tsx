"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  SectionHeader,
  Select,
  Spinner,
  Textarea,
  type BadgeTone,
} from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/utils";
import type { MilestoneOption } from "@/components/task-types";

export type RiskLevel = "low" | "medium" | "high";
export type RiskStatus = "open" | "monitoring" | "mitigated" | "accepted";

export interface RiskCitationRow {
  id: string;
  purpose: "proposal" | "milestone_link";
  excerpt: string | null;
  chunk: {
    id: string;
    pageNumber: number | null;
    sectionTitle: string | null;
    document: { id: string; originalFilename: string };
  };
}

export interface RiskRow {
  id: string;
  milestoneId: string | null;
  milestone: MilestoneOption | null;
  description: string;
  impact: RiskLevel;
  likelihood: RiskLevel;
  mitigation: string | null;
  status: RiskStatus;
  source: "manual" | "ai_suggested";
  citations: RiskCitationRow[];
}

const LEVELS: RiskLevel[] = ["low", "medium", "high"];
const STATUSES: Array<{ value: RiskStatus; label: string }> = [
  { value: "open", label: "Open" },
  { value: "monitoring", label: "Monitoring" },
  { value: "mitigated", label: "Mitigated" },
  { value: "accepted", label: "Accepted" },
];

const LEVEL_TONE = { low: "neutral", medium: "warning", high: "danger" } as const;
const STATUS_TONE = {
  open: "danger",
  monitoring: "warning",
  mitigated: "success",
  accepted: "neutral",
} as const;

/**
 * Impact and likelihood collapse into one chip, coloured by whichever of the
 * two is worse.
 *
 * They used to be two full badges — "impact: high", "likelihood: medium" — which
 * is the same mistake the requirement register made: badging every field means
 * no field stands out, and on a list where almost everything is `high · medium`
 * two identical amber pills per row carry no signal at all. Colouring by the
 * worse axis is not a new severity scale, just a rule for which of the two
 * existing numbers picks the colour; both are still named in the chip and
 * spelled out again in the expanded body.
 */
const LEVEL_RANK = { low: 0, medium: 1, high: 2 } as const;

function exposureTone(impact: RiskLevel, likelihood: RiskLevel): BadgeTone {
  const worst = LEVEL_RANK[impact] >= LEVEL_RANK[likelihood] ? impact : likelihood;
  return LEVEL_TONE[worst];
}

interface Draft {
  description: string;
  milestoneId: string;
  impact: RiskLevel;
  likelihood: RiskLevel;
  mitigation: string;
  status: RiskStatus;
}

const EMPTY: Draft = {
  description: "",
  milestoneId: "",
  impact: "medium",
  likelihood: "medium",
  mitigation: "",
  status: "open",
};

export function RisksPanel({
  projectId,
  initialRisks,
  milestones,
}: {
  projectId: string;
  initialRisks: RiskRow[];
  milestones: MilestoneOption[];
}) {
  const [risks, setRisks] = useState(initialRisks);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();
  const toast = useToast();

  function toggleExpanded(id: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  const openRisks = risks.filter((risk) => risk.status === "open").length;

  function upsert(risk: RiskRow) {
    setRisks((previous) =>
      previous.some((item) => item.id === risk.id)
        ? previous.map((item) => (item.id === risk.id ? risk : item))
        : [risk, ...previous],
    );
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || !draft.description.trim() || saving) return;

    setSaving(true);
    setError(null);
    try {
      const editing = editingId !== null;
      const response = await fetch(
        editing ? `/api/risks/${editingId}` : `/api/projects/${projectId}/risks`,
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: draft.description.trim(),
            milestoneId: draft.milestoneId || null,
            impact: draft.impact,
            likelihood: draft.likelihood,
            mitigation: draft.mitigation.trim() || null,
            status: draft.status,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Could not save the risk.");
        return;
      }
      upsert(data.risk);
      setDraft(null);
      setEditingId(null);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(risk: RiskRow, status: RiskStatus) {
    setBusyId(risk.id);
    setError(null);
    try {
      const response = await fetch(`/api/risks/${risk.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Could not update the risk.");
        return;
      }
      upsert(data.risk);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(risk: RiskRow) {
    const label =
      risk.description.length > 60
        ? `${risk.description.slice(0, 60)}…`
        : risk.description;
    const confirmed = await confirm({
      title: "Delete this risk?",
      body: <p className="italic">“{label}”</p>,
      confirmLabel: "Delete risk",
      tone: "danger",
    });
    if (!confirmed) return;

    setBusyId(risk.id);
    setError(null);
    try {
      const response = await fetch(`/api/risks/${risk.id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? "Could not delete the risk.");
        return;
      }
      setRisks((previous) => previous.filter((item) => item.id !== risk.id));
      toast.success("Deleted risk");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Risks"
        description={
          <>
            {risks.length} recorded
            {openRisks > 0 ? ` · ${openRisks} still open` : null} · open a row for
            its mitigation and sources
          </>
        }
      >
        <Button
          type="button"
          onClick={() => {
            setEditingId(null);
            setDraft({ ...EMPTY });
          }}
        >
          New risk
        </Button>
      </SectionHeader>

      {error ? <ErrorState message={error} /> : null}

      {draft ? (
        <Card className="p-4">
          <form onSubmit={save} className="space-y-3">
            <p className="text-sm font-medium">
              {editingId ? "Edit risk" : "New risk"}
            </p>

            <div>
              <label
                htmlFor="risk-description"
                className="mb-1.5 block text-sm font-medium"
              >
                Description
              </label>
              <Textarea
                id="risk-description"
                value={draft.description}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
                placeholder="e.g. The failover procedure has never been tested against production data volumes"
                rows={2}
                maxLength={4000}
                disabled={saving}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label
                  htmlFor="risk-milestone"
                  className="mb-1 block text-xs text-slate-500"
                >
                  Milestone
                </label>
                <Select
                  id="risk-milestone"
                  className="w-full"
                  value={draft.milestoneId}
                  onChange={(event) =>
                    setDraft({ ...draft, milestoneId: event.target.value })
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
                <label
                  htmlFor="risk-impact"
                  className="mb-1 block text-xs text-slate-500"
                >
                  Impact
                </label>
                <Select
                  id="risk-impact"
                  className="w-full"
                  value={draft.impact}
                  onChange={(event) =>
                    setDraft({ ...draft, impact: event.target.value as RiskLevel })
                  }
                  disabled={saving}
                >
                  {LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label
                  htmlFor="risk-likelihood"
                  className="mb-1 block text-xs text-slate-500"
                >
                  Likelihood
                </label>
                <Select
                  id="risk-likelihood"
                  className="w-full"
                  value={draft.likelihood}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      likelihood: event.target.value as RiskLevel,
                    })
                  }
                  disabled={saving}
                >
                  {LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label
                  htmlFor="risk-status"
                  className="mb-1 block text-xs text-slate-500"
                >
                  Status
                </label>
                <Select
                  id="risk-status"
                  className="w-full"
                  value={draft.status}
                  onChange={(event) =>
                    setDraft({ ...draft, status: event.target.value as RiskStatus })
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
            </div>

            <div>
              <label
                htmlFor="risk-mitigation"
                className="mb-1.5 block text-sm font-medium"
              >
                Mitigation{" "}
                <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <Textarea
                id="risk-mitigation"
                value={draft.mitigation}
                onChange={(event) =>
                  setDraft({ ...draft, mitigation: event.target.value })
                }
                rows={2}
                maxLength={4000}
                disabled={saving}
              />
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
              <Button
                type="submit"
                disabled={saving || !draft.description.trim()}
              >
                {saving ? (
                  <>
                    <Spinner className="border-white/40 border-t-white" />
                    Saving…
                  </>
                ) : editingId ? (
                  "Save changes"
                ) : (
                  "Create risk"
                )}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {risks.length === 0 && !draft ? (
        <EmptyState
          title="No risks recorded"
          description="Record what could derail this project, how likely it is, and what is being done about it."
          action={
            <Button
              type="button"
              onClick={() => {
                setEditingId(null);
                setDraft({ ...EMPTY });
              }}
            >
              Record the first risk
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {risks.map((risk) => {
              const open = expanded.has(risk.id);
              const busy = busyId === risk.id;

              return (
                <li key={risk.id}>
                  {/* Wraps below `sm`, where the fixed-width chips would
                      otherwise leave the description a few characters wide. */}
                  <div
                    className={cn(
                      "flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 transition-colors",
                      open ? "bg-slate-50" : "hover:bg-slate-50/70",
                      busy && "opacity-60",
                    )}
                  >
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => toggleExpanded(risk.id)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    >
                      <ChevronRight
                        aria-hidden
                        className={cn(
                          "size-3.5 shrink-0 text-slate-400 transition-transform",
                          open && "rotate-90",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-900">
                        {risk.description}
                      </span>
                    </button>

                    <div className="flex shrink-0 basis-full items-center gap-1.5 pl-6 sm:basis-auto sm:pl-0">
                      {risk.source === "ai_suggested" ? (
                        <Badge tone="info">AI</Badge>
                      ) : null}
                      <Badge
                        tone={exposureTone(risk.impact, risk.likelihood)}
                        title={`Impact ${risk.impact}, likelihood ${risk.likelihood}`}
                      >
                        {risk.impact} × {risk.likelihood}
                      </Badge>
                      <Badge tone={STATUS_TONE[risk.status]}>{risk.status}</Badge>
                    </div>
                  </div>

                  {open ? (
                    <div className="border-t border-slate-100 bg-slate-50/50 px-3 py-3 pl-9">
                      {/* A two-column list gives the prose one wide measure
                          instead of stacking four narrow labelled blocks. */}
                      <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 text-sm sm:grid-cols-[7rem_minmax(0,1fr)]">
                        <Field name="Risk">
                          <p className="max-w-3xl text-pretty">
                            {risk.description}
                          </p>
                        </Field>

                        <Field name="Mitigation">
                          {risk.mitigation ? (
                            <p className="max-w-3xl text-pretty">
                              {risk.mitigation}
                            </p>
                          ) : (
                            <span className="text-amber-700">
                              None recorded — nothing is being done about this yet.
                            </span>
                          )}
                        </Field>

                        <Field name="Exposure">
                          <span className="text-slate-600">
                            Impact {risk.impact} · likelihood {risk.likelihood}
                          </span>
                        </Field>

                        {risk.milestone ? (
                          <Field name="Milestone">
                            <span className="text-slate-600">
                              {risk.milestone.title}
                            </span>
                          </Field>
                        ) : null}

                        {risk.citations.length > 0 ? (
                          <Field name="Sources">
                            <ul className="space-y-1.5">
                              {risk.citations.map((citation) => (
                                <li key={citation.id}>
                                  <a
                                    href={`/documents/${citation.chunk.document.id}`}
                                    className="text-xs text-slate-700 underline hover:text-slate-900"
                                  >
                                    {citation.chunk.document.originalFilename}
                                    {citation.chunk.pageNumber
                                      ? ` p.${citation.chunk.pageNumber}`
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
                                    <p className="mt-0.5 line-clamp-2 max-w-3xl text-xs text-slate-500 italic">
                                      “{citation.excerpt}”
                                    </p>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </Field>
                        ) : null}
                      </dl>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Select
                          aria-label={`Status for risk: ${risk.description.slice(0, 40)}`}
                          className="h-8 text-xs"
                          value={risk.status}
                          disabled={busy}
                          onChange={(event) =>
                            void changeStatus(risk, event.target.value as RiskStatus)
                          }
                        >
                          {STATUSES.map((status) => (
                            <option key={status.value} value={status.value}>
                              {status.label}
                            </option>
                          ))}
                        </Select>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => {
                            setEditingId(risk.id);
                            setDraft({
                              description: risk.description,
                              milestoneId: risk.milestoneId ?? "",
                              impact: risk.impact,
                              likelihood: risk.likelihood,
                              mitigation: risk.mitigation ?? "",
                              status: risk.status,
                            });
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-700 hover:bg-red-50"
                          disabled={busy}
                          onClick={() => void remove(risk)}
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
        </Card>
      )}
    </div>
  );
}
