import { notFound } from "next/navigation";
import { ChatWorkspace } from "@/components/chat/chat-workspace";
import { requireWorkspace } from "@/lib/auth-guard";
import { listConversations, loadConversation } from "@/lib/chat/history";
import { prisma } from "@/lib/db";
import { officialRecordWhere } from "@/lib/pm/rules";

/**
 * `/chat` and `/chat/<conversationId>` are one route segment on purpose.
 *
 * As two files, pinning a freshly created thread into the address bar would be a
 * route change — unmounting the transcript and replacing the turns that just
 * arrived with a server refetch. With one segment the client can call
 * `history.replaceState`, which Next integrates with `usePathname` and which
 * does not re-fetch the RSC payload.
 *
 * The thread list and the replayed transcript are fetched here and passed down
 * as props, rather than fetched by the client on mount.
 */
export const dynamic = "force-dynamic";

export default async function ChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ thread?: string[] }>;
  searchParams: Promise<{ project?: string }>;
}) {
  const { workspaceId, user } = await requireWorkspace();
  const [{ thread }, { project: requestedProjectId }] = await Promise.all([
    params,
    searchParams,
  ]);

  if (thread && thread.length > 1) notFound();
  const conversationId = thread?.[0];

  const [readyCount, projects, threads, conversation] = await Promise.all([
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
    listConversations(workspaceId, user.id),
    conversationId
      ? loadConversation(workspaceId, user.id, conversationId)
      : Promise.resolve(null),
  ]);

  if (conversationId && !conversation) notFound();

  // An open thread dictates its own scope; `?project=` only seeds a new one.
  const initialProjectId =
    conversation?.conversation.projectId ??
    (requestedProjectId &&
    projects.some((project) => project.id === requestedProjectId)
      ? requestedProjectId
      : "");

  return (
    <ChatWorkspace
      key={conversation?.conversation.id ?? "new"}
      readyDocumentCount={readyCount}
      projects={projects.map((project) => ({
        id: project.id,
        name: project.name,
        readyDocumentCount: project._count.documents,
        liveRecordCount:
          project._count.tasks +
          project._count.milestones +
          project._count.risks,
      }))}
      threads={threads}
      conversation={conversation}
      initialProjectId={initialProjectId}
      // Relative timestamps in the rail must come from one instant, or server
      // render and hydration disagree across a bucket boundary.
      nowIso={new Date().toISOString()}
    />
  );
}
