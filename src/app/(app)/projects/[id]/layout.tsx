import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { requireWorkspace } from "@/lib/auth-guard";
import { getT } from "@/lib/i18n/server";
import { getScopedProject } from "@/lib/pm/project";
import { ProjectMark } from "@/components/project-mark";
import { ProjectTabs } from "@/components/project-tabs";
import { LinkButton, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Shell shared by every project section: breadcrumb, title, and the section
 * tabs.
 *
 * The tabs live here rather than in the sidebar so that each navigation answers
 * one question — the sidebar picks the project, this strip picks the section —
 * and the two can never disagree about where you are. The project lookup is
 * workspace-scoped and deduped with the identical call in each section page via
 * React cache.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { workspaceId, userId } = await requireWorkspace();
  const { id } = await params;

  const project = await getScopedProject(workspaceId, id);
  if (!project) notFound();
  const t = await getT();

  return (
    <div>
      <nav aria-label={t("project.breadcrumbLabel")} className="text-sm">
        <Link href="/projects" className="text-sand-500 hover:text-sand-900">
          {t("project.breadcrumb")}
        </Link>
        <span aria-hidden className="mx-1.5 text-sand-300">
          /
        </span>
        <span className="text-sand-700">{project.name}</span>
      </nav>

      {/* Asking is secondary here: within a section, the section's own action
          (add a task, upload, extract) is the primary one. */}
      <PageHeader
        className="mt-3 mb-5"
        title={
          <span className="flex items-center gap-3">
            <ProjectMark
              id={project.id}
              name={project.name}
              personal={project.personalOwnerId === userId}
              className="size-9 rounded-xl text-base"
            />
            <span className="min-w-0">{project.name}</span>
          </span>
        }
        lead={project.description ?? undefined}
        actions={
          <LinkButton href={`/chat?project=${project.id}`} variant="secondary">
            <MessageSquare className="size-4" aria-hidden />
            {t("project.ask")}
          </LinkButton>
        }
      />

      <ProjectTabs
        projectId={project.id}
        deliveryEnabled={project.deliveryEnabled}
        discoveryEnabled={project.discoveryEnabled}
      />

      <div className="mt-6">{children}</div>
    </div>
  );
}
