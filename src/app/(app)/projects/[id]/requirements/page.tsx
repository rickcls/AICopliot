import { notFound } from "next/navigation";
import {
  RequirementsPanel,
  type RequirementRow,
  type RequirementRunSummary,
} from "@/components/requirements-panel";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { getRequirementRuns } from "@/lib/generation/requirements-service";
import { getScopedProject } from "@/lib/pm/project";
import { parseRegisterFilter } from "@/lib/pm/filters";
import { officialRecordWhere } from "@/lib/pm/rules";
import { requirementSelect } from "@/lib/pm/select";

export const dynamic = "force-dynamic";

export default async function ProjectRequirementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ filter?: string | string[] }>;
}) {
  const { workspaceId } = await requireWorkspace();
  const { id } = await params;
  const { filter } = await searchParams;

  const project = await getScopedProject(workspaceId, id);
  if (!project) notFound();

  const [requirements, readyDocuments, tasks, runs] = await Promise.all([
    // Not officialRecordWhere: the register shows drafts on purpose. Coverage
    // and grounding reads still use the baselined predicate. See invariant 14.
    prisma.requirement.findMany({
      where: { workspaceId, projectId: project.id },
      orderBy: { sequence: "asc" },
      select: requirementSelect,
    }),
    prisma.document.findMany({
      where: { workspaceId, projectId: project.id, status: "ready" },
      orderBy: { createdAt: "asc" },
      select: { id: true, originalFilename: true, chunkCount: true },
    }),
    prisma.task.findMany({
      where: officialRecordWhere({ workspaceId, projectId: project.id }),
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true },
    }),
    getRequirementRuns(workspaceId, project.id),
  ]);

  // Date instances cannot cross the server/client boundary, and the panel does
  // not render them, so they are dropped rather than serialised.
  const initialRequirements: RequirementRow[] = requirements.map(
    ({ reviewedAt: _reviewedAt, createdAt: _createdAt, ...requirement }) =>
      requirement,
  );

  const active = runs.find(
    (run) => run.status === "processing" || run.status === "draft",
  );
  const activeRun: RequirementRunSummary | null = active
    ? {
        id: active.id,
        status: active.status,
        errorMessage: active.errorMessage,
        createdAt: active.createdAt.toISOString(),
      }
    : null;

  return (
    <RequirementsPanel
      projectId={project.id}
      initialRequirements={initialRequirements}
      readyDocuments={readyDocuments}
      taskOptions={tasks}
      activeRun={activeRun}
      initialFilter={parseRegisterFilter(filter)}
    />
  );
}
