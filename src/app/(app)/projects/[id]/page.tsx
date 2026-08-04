import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentsPanel } from "@/components/documents-panel";
import { Badge } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ProjectWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { workspaceId } = await requireWorkspace();
  const { id } = await params;

  const project = await prisma.project.findFirst({
    where: { id, workspaceId },
    include: {
      documents: {
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
      },
    },
  });

  if (!project) notFound();

  const readyCount = project.documents.filter(
    (document) => document.status === "ready",
  ).length;

  return (
    <div>
      <Link href="/projects" className="text-sm text-slate-500 hover:text-slate-900">
        ← All projects
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
            <Badge tone="info">Project workspace</Badge>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-pretty text-slate-600">
            {project.description || "No project description."}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            {project.documents.length} document
            {project.documents.length === 1 ? "" : "s"} · {readyCount} indexed
          </p>
        </div>
        <Link
          href={`/chat?project=${project.id}`}
          className="inline-flex h-10 items-center rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700"
        >
          Ask this project
        </Link>
      </div>

      <div className="mt-6">
        <DocumentsPanel
          initialDocuments={project.documents.map((document) => ({
            ...document,
            createdAt: document.createdAt.toISOString(),
          }))}
          projects={[{ id: project.id, name: project.name }]}
          initialProjectFilter={project.id}
          fixedProject={{ id: project.id, name: project.name }}
        />
      </div>
    </div>
  );
}
