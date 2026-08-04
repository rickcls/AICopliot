import { DocumentsPanel } from "@/components/documents-panel";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { workspaceId } = await requireWorkspace();

  // Loaded server-side so the client component renders with data on first
  // paint; it only refetches while an ingestion is in flight.
  const documents = await prisma.document.findMany({
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
    },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="mt-1 text-sm text-slate-600">
          Upload operational documents to make them searchable. A document is
          only marked ready once its text has been extracted and indexed.
        </p>
      </div>
      <DocumentsPanel
        initialDocuments={documents.map((doc) => ({
          ...doc,
          createdAt: doc.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
