import { notFound } from "next/navigation";
import {
  ReviewPanel,
  type ReviewRunView,
} from "@/components/review-panel";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { getProjectPlanRuns } from "@/lib/generation/service";
import { getScopedProject } from "@/lib/pm/project";

export const dynamic = "force-dynamic";

export default async function ProjectReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { workspaceId } = await requireWorkspace();
  const { id } = await params;
  const project = await getScopedProject(workspaceId, id);
  if (!project) notFound();

  const [readyDocuments, runs] = await Promise.all([
    prisma.document.findMany({
      where: {
        workspaceId,
        projectId: project.id,
        status: "ready",
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, originalFilename: true, chunkCount: true },
    }),
    getProjectPlanRuns(workspaceId, project.id),
  ]);

  // Dates and Prisma JSON values cross a client boundary on this page. This is
  // an intentional immutable view model rather than exposing ORM instances.
  const initialRuns = JSON.parse(JSON.stringify(runs)) as ReviewRunView[];

  return (
    <ReviewPanel
      projectId={project.id}
      readyDocuments={readyDocuments}
      initialRuns={initialRuns}
    />
  );
}
