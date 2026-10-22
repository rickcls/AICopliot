"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileText, FolderKanban, MessageSquare, ShieldAlert, SquareKanban } from "lucide-react";
import { ProjectMark } from "@/components/project-mark";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FOCUS_RING,
  LinkButton,
  Input,
  Spinner,
  Textarea,
} from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
import { useDateLocale, useT } from "@/components/i18n-provider";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/utils";

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  /** The viewer's own project, which carries a person mark. */
  personal: boolean;
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
  const t = useT();
  const dateLocale = useDateLocale();

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
        setError(data.error ?? t("projects.createFailed"));
        return;
      }

      setProjects((previous) =>
        [
          ...previous,
          {
            id: data.project.id,
            name: data.project.name,
            description: data.project.description,
            personal: false,
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
      toast.success(t("projects.created", { name: data.project.name }));
      // The sidebar's project list comes from the layout, not this panel's
      // local state — same reason delete calls refresh below. Push first: a
      // navigation discards any router action still pending, so a refresh
      // issued before it never lands. Queued after it, the refresh runs once
      // the new page is in and re-renders the layout's list.
      router.push(`/projects/${data.project.id}`);
      router.refresh();
    } catch {
      setError(t("common.couldNotReach"));
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
    const destroyedLabel = new Intl.ListFormat(dateLocale, { type: "conjunction" }).format(
      destroyed
        .filter(([count]) => count > 0)
        .map(([count, noun]) => t(`projects.nouns.${noun}`, { count })),
    );

    // An empty project has nothing to warn about, and an empty container still
    // occupies its margin — leaving a gap that reads as content failing to load.
    const hasConsequences = destroyedLabel !== "" || project.documentCount > 0;

    const confirmed = await confirm({
      title: t("projects.deleteTitle", { name: project.name }),
      body: hasConsequences ? (
        <div className="space-y-2">
          {destroyedLabel ? (
            <p className="font-medium text-red-700">
              {t("projects.deleteDestroyed", { items: destroyedLabel })}
            </p>
          ) : null}
          {project.documentCount ? (
            <p>{t("projects.deleteDocuments", { count: project.documentCount })}</p>
          ) : null}
        </div>
      ) : undefined,
      confirmLabel: t("projects.deleteConfirm"),
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
        setError(data.error ?? t("projects.deleteFailed"));
        return;
      }
      setProjects((previous) =>
        previous.filter((item) => item.id !== project.id),
      );
      toast.success(t("projects.deleted", { name: project.name }));
      // The sidebar's project list is rendered by the layout above this page,
      // so removing the card locally leaves a nav entry pointing at a project
      // that no longer exists. Local state already dropped the row, so this
      // refetch changes nothing visible here.
      router.refresh();
    } catch {
      setError(t("common.couldNotReach"));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* One line until there is a name to describe: the form used to open
          the page as a full card above the list it adds to. */}
      <Card className="p-4">
        <form onSubmit={createProject} className="space-y-3">
          <label htmlFor="project-name" className="block text-sm font-medium text-sand-900">
            {t("projects.name")}
          </label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("projects.namePlaceholder")}
              maxLength={120}
              disabled={saving}
              className="min-w-0 flex-1 basis-60"
            />
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? (
                <>
                  <Spinner inverse />
                  {t("projects.creating")}
                </>
              ) : (
                t("projects.create")
              )}
            </Button>
          </div>
          {name.trim() ? (
            <div>
              <label
                htmlFor="project-description"
                className="mb-1.5 block text-sm font-medium text-sand-900"
              >
                {t("projects.description")}{" "}
                <span className="font-normal text-sand-500">{t("projects.optional")}</span>
              </label>
              <Textarea
                id="project-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t("projects.descriptionPlaceholder")}
                rows={2}
                maxLength={1000}
                disabled={saving}
              />
            </div>
          ) : null}
        </form>
      </Card>

      {error ? <ErrorState message={error} /> : null}

      {projects.length === 0 ? (
        <EmptyState
          icon={<FolderKanban className="size-5" />}
          title={t("projects.emptyTitle")}
          description={t("projects.emptyBody")}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <Card
              key={project.id}
              className="relative flex flex-col p-5 transition-[border-color,box-shadow] hover:border-sand-300 hover:shadow-md"
            >
              <div className="flex items-center gap-3">
                <ProjectMark
                  id={project.id}
                  name={project.name}
                  personal={project.personal}
                  className="size-9 rounded-xl text-sm"
                />
                {/* The name's link covers the whole card (the `after:` layer),
                    so the card opens the project; the buttons below sit above
                    that layer. A separate "Open" button only repeated it. */}
                <Link
                  href={`/projects/${project.id}`}
                  className={cn(
                    "min-w-0 truncate rounded text-base font-semibold text-sand-900 after:absolute after:inset-0 after:rounded-2xl",
                    FOCUS_RING,
                  )}
                >
                  {project.name}
                </Link>
              </div>
              <p className="mt-3 line-clamp-3 flex-1 text-sm text-pretty text-sand-600">
                {project.description || t("projects.noDescription")}
              </p>
              <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-sand-500">
                <span className="inline-flex items-center gap-1.5">
                  <SquareKanban aria-hidden className="size-3.5 text-sand-400" />
                  {t("projects.nouns.task", { count: project.taskCount })}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <FileText aria-hidden className="size-3.5 text-sand-400" />
                  {t("projects.nouns.document", { count: project.documentCount })}
                </span>
                {project.riskCount > 0 ? (
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldAlert aria-hidden className="size-3.5 text-sand-400" />
                    {t("projects.nouns.risk", { count: project.riskCount })}
                  </span>
                ) : null}
              </p>
              <div className="relative z-10 mt-4 flex items-center gap-2 border-t border-sand-100 pt-3">
                <LinkButton
                  href={`/chat?project=${project.id}`}
                  variant="ghost"
                  size="sm"
                  className="-ml-2"
                >
                  <MessageSquare className="size-3.5" aria-hidden />
                  {t("projects.ask")}
                </LinkButton>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="ml-auto -mr-2 text-sand-500 hover:text-red-700"
                  disabled={deletingId === project.id}
                  onClick={() => void deleteProject(project)}
                >
                  {t("common.delete")}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
