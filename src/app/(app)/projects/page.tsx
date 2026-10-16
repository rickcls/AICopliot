import { LayoutDashboard } from "lucide-react";
import { ProjectsPanel } from "@/components/projects-panel";
import { LinkButton } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const { workspaceId } = await requireWorkspace();
  const t = await getT();
  const projects = await prisma.project.findMany({
    where: { workspaceId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      _count: {
        select: {
          documents: true,
          tasks: true,
          milestones: true,
          risks: true,
          requirements: true,
        },
      },
    },
  });

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("nav.projects")}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Each project is a separate document workspace. Open one to upload its
            documents and ask questions using only that project&apos;s knowledge.
          </p>
        </div>
        {/* The workspace-wide summary left the sidebar when Today became home;
            it is a view across projects, so it is reached from here. */}
        <LinkButton href="/dashboard" variant="secondary">
          <LayoutDashboard className="size-4" aria-hidden />
          {t("dashboard.link")}
        </LinkButton>
      </div>
      <ProjectsPanel
        initialProjects={projects.map((project) => ({
          id: project.id,
          name: project.name,
          description: project.description,
          documentCount: project._count.documents,
          taskCount: project._count.tasks,
          milestoneCount: project._count.milestones,
          riskCount: project._count.risks,
          requirementCount: project._count.requirements,
        }))}
      />
    </div>
  );
}
