"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Spinner,
  Textarea,
} from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  documentCount: number;
  taskCount: number;
  milestoneCount: number;
  riskCount: number;
  requirementCount: number;
}

export function ProjectsPanel({
  initialProjects,
}: {
  initialProjects: ProjectRow[];
}) {
  const [projects, setProjects] = useState(initialProjects);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();

  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Could not create the project.");
        return;
      }

      setProjects((previous) =>
        [
          ...previous,
          {
            id: data.project.id,
            name: data.project.name,
            description: data.project.description,
            documentCount: data.project._count.documents,
            taskCount: data.project._count.tasks,
            milestoneCount: data.project._count.milestones,
            riskCount: data.project._count.risks,
          requirementCount: data.project._count.requirements,
          },
        ].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setName("");
      setDescription("");
      toast.success(`Created “${data.project.name}”`);
      router.push(`/projects/${data.project.id}`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteProject(project: ProjectRow) {
    // Documents survive as unassigned records; project-management records
    // cannot exist without a project and are destroyed. Say which is which
    // before asking, and name the counts.
    const destroyed = [
      [project.requirementCount, "requirement"],
      [project.taskCount, "task"],
      [project.milestoneCount, "milestone"],
      [project.riskCount, "risk"],
    ] as const;
    const destroyedLabel = destroyed
      .filter(([count]) => count > 0)
      .map(([count, noun]) => `${count} ${noun}${count === 1 ? "" : "s"}`)
      .join(", ");

    // An empty project has nothing to warn about, and an empty container still
    // occupies its margin — leaving a gap that reads as content failing to load.
    const hasConsequences = destroyedLabel !== "" || project.documentCount > 0;

    const confirmed = await confirm({
      title: `Delete “${project.name}”?`,
      body: hasConsequences ? (
        <div className="space-y-2">
          {destroyedLabel ? (
            <p>
              <span className="font-medium text-red-700">{destroyedLabel}</span>{" "}
              will be permanently deleted.
            </p>
          ) : null}
          {project.documentCount ? (
            <p>
              {project.documentCount} document
              {project.documentCount === 1 ? "" : "s"} will become unassigned
              and remain available.
            </p>
          ) : null}
        </div>
      ) : undefined,
      confirmLabel: "Delete project",
      tone: "danger",
    });
    if (!confirmed) return;

    setDeletingId(project.id);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? "Could not delete the project.");
        return;
      }
      setProjects((previous) =>
        previous.filter((item) => item.id !== project.id),
      );
      toast.success(`Deleted “${project.name}”`);
      // The sidebar's project list is rendered by the layout above this page,
      // so removing the card locally leaves a nav entry pointing at a project
      // that no longer exists. Local state already dropped the row, so this
      // refetch changes nothing visible here.
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <form onSubmit={createProject} className="space-y-3">
          <div>
            <label htmlFor="project-name" className="mb-1.5 block text-sm font-medium">
              Project name
            </label>
            <Input
              id="project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Airport Display Upgrade"
              maxLength={120}
              disabled={saving}
            />
          </div>
          <div>
            <label
              htmlFor="project-description"
              className="mb-1.5 block text-sm font-medium"
            >
              Description <span className="font-normal text-slate-500">(optional)</span>
            </label>
            <Textarea
              id="project-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What operational work belongs in this project?"
              rows={2}
              maxLength={1000}
              disabled={saving}
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? (
                <>
                  <Spinner className="border-white/40 border-t-white" />
                  Creating…
                </>
              ) : (
                "Create project"
              )}
            </Button>
          </div>
        </form>
      </Card>

      {error ? <ErrorState message={error} /> : null}

      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Create a project to separate document libraries and restrict answers to the right operational context."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {projects.map((project) => (
            <Card key={project.id} className="flex flex-col p-5">
              <Link
                href={`/projects/${project.id}`}
                className="text-sm font-semibold hover:underline"
              >
                {project.name}
              </Link>
              <p className="mt-1 flex-1 text-sm text-pretty text-slate-600">
                {project.description || "No description."}
              </p>
              <p className="mt-4 text-xs text-slate-500">
                {project.documentCount} document
                {project.documentCount === 1 ? "" : "s"} · {project.taskCount}{" "}
                task{project.taskCount === 1 ? "" : "s"} ·{" "}
                {project.riskCount} risk{project.riskCount === 1 ? "" : "s"}
              </p>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                <Link
                  href={`/projects/${project.id}`}
                  className="inline-flex h-8 items-center rounded-lg bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-700"
                >
                  Open project
                </Link>
                <Link
                  href={`/chat?project=${project.id}`}
                  className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium hover:bg-slate-50"
                >
                  Ask
                </Link>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  disabled={deletingId === project.id}
                  onClick={() => void deleteProject(project)}
                >
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
