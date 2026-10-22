import { LayoutDashboard } from "lucide-react";
import { ProjectsPanel } from "@/components/projects-panel";
import { LinkButton, PageHeader } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { visibleProjectWhere } from "@/lib/pm/visibility";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const { workspaceId, userId } = await requireWorkspace();
  const t = await getT();
  const projects = await prisma.project.findMany({
    where: visibleProjectWhere(workspaceId, userId),
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      personalOwnerId: true,
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
      {/* The workspace-wide summary left the sidebar when Today became home;
          it is a view across projects, so it is reached from here. */}
      <PageHeader
        title={t("nav.projects")}
        lead={t("projects.lead")}
        actions={
          <LinkButton href="/dashboard" variant="secondary">
            <LayoutDashboard className="size-4" aria-hidden />
            {t("dashboard.link")}
          </LinkButton>
        }
      />
      <ProjectsPanel
        initialProjects={projects.map((project) => ({
          id: project.id,
          name: project.name,
          description: project.description,
          personal: project.personalOwnerId === userId,
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
