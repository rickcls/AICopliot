import { notFound } from "next/navigation";
import { StatusReportsPanel } from "@/components/status-reports-panel";
import { requireWorkspace } from "@/lib/auth-guard";
import { getScopedProject } from "@/lib/pm/project";
import { listStatusReports } from "@/lib/reports/service";

export const dynamic = "force-dynamic";

export default async function ProjectReportsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { workspaceId } = await requireWorkspace();
  const { id } = await params;
  const project = await getScopedProject(workspaceId, id);
  if (!project) notFound();

  const reports = await listStatusReports(workspaceId, project.id);
  return <StatusReportsPanel projectId={project.id} initialReports={reports} />;
}
