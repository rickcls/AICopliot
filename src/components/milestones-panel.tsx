"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Input,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { formatDay } from "@/lib/utils";

export type MilestoneStatus =
  | "not_started"
  | "on_track"
  | "at_risk"
  | "blocked"
  | "completed";

export interface MilestoneCitationRow {
  id: string;
  excerpt: string | null;
  chunk: {
    id: string;
    pageNumber: number | null;
    sectionTitle: string | null;
    document: { id: string; originalFilename: string };
  };
}

export interface MilestoneRow {
  id: string;
  title: string;
  description: string | null;
  /** ISO string — Dates are serialised before crossing to the client. */
  targetDate: string | null;
  completedAt: string | null;
  status: MilestoneStatus;
  source: "manual" | "ai_suggested";
  citations: MilestoneCitationRow[];
}

const STATUSES: Array<{ value: MilestoneStatus; label: string }> = [
  { value: "not_started", label: "Not started" },
  { value: "on_track", label: "On track" },
  { value: "at_risk", label: "At risk" },
  { value: "blocked", label: "Blocked" },
  { value: "completed", label: "Completed" },
];

const STATUS_TONE = {
  not_started: "neutral",
  on_track: "success",
  at_risk: "warning",
  blocked: "danger",
  completed: "info",
} as const;

interface Draft {
  title: string;
  description: string;
  targetDate: string;
  status: MilestoneStatus;
}

const EMPTY: Draft = {
  title: "",
  description: "",
  targetDate: "",
  status: "not_started",
};

export function MilestonesPanel({
  projectId,
  initialMilestones,
}: {
  projectId: string;
  initialMilestones: MilestoneRow[];
}) {
  const [milestones, setMilestones] = useState(initialMilestones);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function upsert(milestone: MilestoneRow) {
    setMilestones((previous) =>
      previous.some((item) => item.id === milestone.id)
        ? previous.map((item) => (item.id === milestone.id ? milestone : item))
        : [...previous, milestone],
    );
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
          ? `/api/milestones/${editingId}`
          : `/api/projects/${projectId}/milestones`,
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: draft.title.trim(),
            description: draft.description.trim() || null,
            targetDate: draft.targetDate || null,
            status: draft.status,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Could not save the milestone.");
        return;
      }
      upsert(data.milestone);
      setDraft(null);
      setEditingId(null);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(milestone: MilestoneRow, status: MilestoneStatus) {
    setBusyId(milestone.id);
    setError(null);
    try {
      const response = await fetch(`/api/milestones/${milestone.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Could not update the milestone.");
        return;
      }
      upsert(data.milestone);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(milestone: MilestoneRow) {
    if (!confirm(`Delete milestone "${milestone.title}"?`)) return;

    setBusyId(milestone.id);
    setError(null);
    try {
      const response = await fetch(`/api/milestones/${milestone.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? "Could not delete the milestone.");
        return;
      }
      setMilestones((previous) =>
        previous.filter((item) => item.id !== milestone.id),
      );
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Milestones</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Dated checkpoints. These appear in the timeline above.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setEditingId(null);
            setDraft({ ...EMPTY });
          }}
        >
          New milestone
        </Button>
      </div>

      {error ? (
        <div className="mt-3">
          <ErrorState message={error} />
        </div>
      ) : null}

      {draft ? (
        <form onSubmit={save} className="mt-4 space-y-3 rounded-lg bg-slate-50 p-3">
          <div>
            <label
              htmlFor="milestone-title"
              className="mb-1.5 block text-sm font-medium"
            >
              Title
            </label>
            <Input
              id="milestone-title"
              value={draft.title}
              onChange={(event) =>
                setDraft({ ...draft, title: event.target.value })
              }
              placeholder="e.g. UAT sign-off"
              maxLength={200}
              disabled={saving}
            />
          </div>

          <div>
            <label
              htmlFor="milestone-description"
              className="mb-1.5 block text-sm font-medium"
            >
              Description{" "}
              <span className="font-normal text-slate-500">(optional)</span>
            </label>
            <Textarea
              id="milestone-description"
              value={draft.description}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
              rows={2}
              maxLength={4000}
              disabled={saving}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="milestone-date"
                className="mb-1 block text-xs text-slate-500"
              >
                Target date
              </label>
              <Input
                id="milestone-date"
                type="date"
                value={draft.targetDate}
                onChange={(event) =>
                  setDraft({ ...draft, targetDate: event.target.value })
                }
                disabled={saving}
              />
            </div>
            <div>
              <label
                htmlFor="milestone-status"
                className="mb-1 block text-xs text-slate-500"
              >
                Status
              </label>
              <Select
                id="milestone-status"
                className="w-full"
                value={draft.status}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    status: event.target.value as MilestoneStatus,
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
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setDraft(null);
                setEditingId(null);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving || !draft.title.trim()}>
              {saving ? (
                <>
                  <Spinner className="border-white/40 border-t-white" />
                  Saving…
                </>
              ) : editingId ? (
                "Save changes"
              ) : (
                "Create milestone"
              )}
            </Button>
          </div>
        </form>
      ) : null}

      {milestones.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">
          No milestones yet. Add one to mark a checkpoint in this project.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100">
          {milestones.map((milestone) => (
            <li key={milestone.id} className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{milestone.title}</p>
                  {milestone.description ? (
                    <p className="mt-0.5 text-xs text-pretty text-slate-600">
                      {milestone.description}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-slate-500">
                    {milestone.targetDate
                      ? formatDay(milestone.targetDate)
                      : "No target date"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATUS_TONE[milestone.status]}>
                    {milestone.status.replace("_", " ")}
                  </Badge>
                  <Badge
                    tone={milestone.source === "manual" ? "neutral" : "info"}
                  >
                    {milestone.source === "manual" ? "Manual" : "AI suggested"}
                  </Badge>
                </div>
              </div>

              {milestone.citations.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {milestone.citations.map((citation) => (
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
                      {citation.excerpt ? (
                        <p className="mt-0.5 text-slate-500 italic">
                          “{citation.excerpt}”
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Select
                  aria-label={`Status for ${milestone.title}`}
                  className="h-8 text-xs"
                  value={milestone.status}
                  disabled={busyId === milestone.id}
                  onChange={(event) =>
                    void changeStatus(
                      milestone,
                      event.target.value as MilestoneStatus,
                    )
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
                  disabled={busyId === milestone.id}
                  onClick={() => {
                    setEditingId(milestone.id);
                    setDraft({
                      title: milestone.title,
                      description: milestone.description ?? "",
                      targetDate: milestone.targetDate
                        ? milestone.targetDate.slice(0, 10)
                        : "",
                      status: milestone.status,
                    });
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-700 hover:bg-red-50"
                  disabled={busyId === milestone.id}
                  onClick={() => void remove(milestone)}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
