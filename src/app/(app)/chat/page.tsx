import { ChatPanel } from "@/components/chat-panel";
import { prisma } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { workspaceId } = await requireWorkspace();
  const requestedProjectId = (await searchParams).project;

  const [readyCount, projects] = await Promise.all([
    prisma.document.count({ where: { workspaceId, status: "ready" } }),
    prisma.project.findMany({
      where: { workspaceId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        _count: {
          select: { documents: { where: { status: "ready" } } },
        },
      },
    }),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Ask</h1>
        <p className="mt-1 text-sm text-slate-600">
          Answers come only from your uploaded documents. If the documents
          don&apos;t cover it, the assistant will say so.
        </p>
      </div>
      <ChatPanel
        readyDocumentCount={readyCount}
        initialProjectId={
          requestedProjectId && projects.some((project) => project.id === requestedProjectId)
            ? requestedProjectId
            : ""
        }
        projects={projects.map((project) => ({
          id: project.id,
          name: project.name,
          readyDocumentCount: project._count.documents,
        }))}
      />
    </div>
  );
}
