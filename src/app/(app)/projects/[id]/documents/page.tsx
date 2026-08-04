import { notFound } from "next/navigation";
import { DocumentsPanel } from "@/components/documents-panel";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { getScopedProject } from "@/lib/pm/project";

export const dynamic = "force-dynamic";

/**
 * The project's document library — unchanged behaviour, moved out of the old
 * single-purpose detail page now that the project has tabs.
 */
export default async function ProjectDocumentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { workspaceId } = await requireWorkspace();
  const { id } = await params;

  const project = await getScopedProject(workspaceId, id);
  if (!project) notFound();

  const documents = await prisma.document.findMany({
    where: { workspaceId, projectId: project.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      originalFilename: true,
      sizeBytes: true,
      status: true,
      errorMessage: true,
      chunkCount: true,
      createdAt: true,
      projectId: true,
      project: { select: { name: true } },
    },
  });

  return (
    <DocumentsPanel
      initialDocuments={documents.map((document) => ({
        ...document,
        createdAt: document.createdAt.toISOString(),
      }))}
      projects={[{ id: project.id, name: project.name }]}
      initialProjectFilter={project.id}
      fixedProject={{ id: project.id, name: project.name }}
    />
  );
}
