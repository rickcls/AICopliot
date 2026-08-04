import { notFound } from "next/navigation";
import { RisksPanel } from "@/components/risks-panel";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { getScopedProject } from "@/lib/pm/project";
import { riskSelect } from "@/lib/pm/select";

export const dynamic = "force-dynamic";

export default async function ProjectRisksPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { workspaceId } = await requireWorkspace();
  const { id } = await params;

  const project = await getScopedProject(workspaceId, id);
  if (!project) notFound();

  const risks = await prisma.projectRisk.findMany({
    where: { workspaceId, projectId: project.id },
    orderBy: { createdAt: "desc" },
    select: riskSelect,
  });

  return <RisksPanel projectId={project.id} initialRisks={risks} />;
}
