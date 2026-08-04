import { ProjectsPanel } from "@/components/projects-panel";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const { workspaceId } = await requireWorkspace();
  const projects = await prisma.project.findMany({
    where: { workspaceId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      _count: {
        select: { documents: true, tasks: true, milestones: true, risks: true },
      },
    },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <p className="mt-1 text-sm text-slate-600">
          Each project is a separate document workspace. Open one to upload its
          documents and ask questions using only that project&apos;s knowledge.
        </p>
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
        }))}
      />
    </div>
  );
}
