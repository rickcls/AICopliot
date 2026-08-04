import { DocumentsPanel } from "@/components/documents-panel";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { workspaceId } = await requireWorkspace();
  const requestedProjectId = (await searchParams).project;

  // Loaded server-side so the client component renders with data on first
  // paint; it only refetches while an ingestion is in flight.
  const [documents, projects] = await Promise.all([
    prisma.document.findMany({
      where: { workspaceId },
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
    }),
    prisma.project.findMany({
      where: { workspaceId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">All Documents</h1>
        <p className="mt-1 text-sm text-slate-600">
          Manage documents across every project, reassign them, or leave them
          unassigned. Open a project for a focused document workspace.
        </p>
      </div>
      <DocumentsPanel
        projects={projects}
        initialProjectFilter={
          requestedProjectId && projects.some((project) => project.id === requestedProjectId)
            ? requestedProjectId
            : "all"
        }
        initialDocuments={documents.map((doc) => ({
          ...doc,
          createdAt: doc.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
