import { ChatPanel } from "@/components/chat-panel";
import { prisma } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth-guard";
import { officialRecordWhere } from "@/lib/pm/rules";

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
          select: {
            documents: { where: { status: "ready" } },
            tasks: { where: officialRecordWhere({}) },
            milestones: { where: officialRecordWhere({}) },
            risks: { where: officialRecordWhere({}) },
          },
        },
      },
    }),
  ]);
  const initialProjectId =
    requestedProjectId &&
    projects.some((project) => project.id === requestedProjectId)
      ? requestedProjectId
      : "";

  return (
    // Prose, unlike the board and Gantt, gets harder to read as it widens — so
    // this page opts out of the full-width shell.
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Ask</h1>
        <p className="mt-1 text-sm text-slate-600">
          Global answers use uploaded documents. A selected project also uses
          its current approved tasks, milestones, risks, and dependencies.
        </p>
      </div>
      <ChatPanel
        key={initialProjectId || "global"}
        readyDocumentCount={readyCount}
        initialProjectId={initialProjectId}
        projects={projects.map((project) => ({
          id: project.id,
          name: project.name,
          readyDocumentCount: project._count.documents,
          liveRecordCount:
            project._count.tasks +
            project._count.milestones +
            project._count.risks,
        }))}
      />
    </div>
  );
}
