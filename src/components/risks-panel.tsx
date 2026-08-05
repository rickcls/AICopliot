"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
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
  const [error, setError] = useState<string | null>(null);

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
    if (!confirm(`Delete this risk?\n\n"${label}"`)) return;

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
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Risks</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {risks.length} recorded · manually entered risks and document-derived
            ones are labelled separately
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setEditingId(null);
            setDraft({ ...EMPTY });
          }}
        >
          New risk
        </Button>
      </div>

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
        <Card className="divide-y divide-slate-100">
          {risks.map((risk) => (
            <div key={risk.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="min-w-0 flex-1 text-sm text-pretty">
                  {risk.description}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={LEVEL_TONE[risk.impact]}>
                    impact: {risk.impact}
                  </Badge>
                  <Badge tone={LEVEL_TONE[risk.likelihood]}>
                    likelihood: {risk.likelihood}
                  </Badge>
                  <Badge tone={STATUS_TONE[risk.status]}>{risk.status}</Badge>
                  <Badge tone={risk.source === "manual" ? "neutral" : "info"}>
                    {risk.source === "manual" ? "Manual" : "AI suggested"}
                  </Badge>
                </div>
              </div>

              {risk.mitigation ? (
                <p className="mt-2 text-xs text-slate-600">
                  <span className="font-medium">Mitigation: </span>
                  {risk.mitigation}
                </p>
              ) : null}

              {risk.milestone ? (
                <p className="mt-2 text-xs text-slate-600">
                  <span className="font-medium">Milestone: </span>
                  {risk.milestone.title}
                </p>
              ) : null}

              {risk.citations.length > 0 ? (
                <div className="mt-2">
                  <p className="text-xs font-medium text-slate-600">Sources</p>
                  <ul className="mt-1 space-y-1">
                    {risk.citations.map((citation) => (
                      <li key={citation.id} className="text-xs">
                        <a
                          href={`/documents/${citation.chunk.document.id}`}
                          className="text-slate-700 underline hover:text-slate-900"
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
                          <p className="mt-0.5 text-slate-500 italic">
                            “{citation.excerpt}”
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Select
                  aria-label={`Status for risk: ${risk.description.slice(0, 40)}`}
                  className="h-8 text-xs"
                  value={risk.status}
                  disabled={busyId === risk.id}
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
                  variant="ghost"
                  disabled={busyId === risk.id}
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
                  disabled={busyId === risk.id}
                  onClick={() => void remove(risk)}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
