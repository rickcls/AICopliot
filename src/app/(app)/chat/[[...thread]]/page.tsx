import { notFound } from "next/navigation";
import { ChatWorkspace } from "@/components/chat/chat-workspace";
import type { ChatFocusState, FocusOptions } from "@/components/chat/types";
import { requireWorkspace } from "@/lib/auth-guard";
import { listConversations, loadConversation } from "@/lib/chat/history";
import { prisma } from "@/lib/db";
import { officialRecordWhere } from "@/lib/pm/rules";
import { MAX_FOCUS_DOCUMENTS } from "@/lib/schemas";

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
  searchParams: Promise<{ project?: string; task?: string; docs?: string }>;
}) {
  const { workspaceId, user } = await requireWorkspace();
  const [
    { thread },
    { project: requestedProjectId, task: requestedTaskId, docs: requestedDocs },
  ] = await Promise.all([params, searchParams]);

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

  // `?task=` names its own project, so it is resolved first. Any id that does
  // not resolve inside this workspace is ignored rather than trusted — the
  // chat route re-checks everything again when the first question is sent.
  const requestedTask =
    !conversation && requestedTaskId
      ? await prisma.task.findFirst({
          where: officialRecordWhere({ id: requestedTaskId, workspaceId }),
          select: { id: true, title: true, projectId: true },
        })
      : null;

  // An open thread dictates its own scope; the query only seeds a new one.
  const initialProjectId =
    conversation?.conversation.projectId ??
    requestedTask?.projectId ??
    (requestedProjectId &&
    projects.some((project) => project.id === requestedProjectId)
      ? requestedProjectId
      : "");

  const requestedDocumentIds =
    !conversation && !requestedTask && requestedDocs
      ? requestedDocs.split(",").filter(Boolean).slice(0, MAX_FOCUS_DOCUMENTS)
      : [];
  const focusDocumentIds =
    conversation?.conversation.focus === "documents"
      ? conversation.conversation.focusDocumentIds
      : requestedDocumentIds;

  const [focusDocuments, focusOptions] = await Promise.all([
    focusDocumentIds.length > 0
      ? prisma.document.findMany({
          where: {
            id: { in: focusDocumentIds },
            workspaceId,
            ...(initialProjectId ? { projectId: initialProjectId } : {}),
          },
          orderBy: { originalFilename: "asc" },
          select: { id: true, originalFilename: true },
        })
      : Promise.resolve([]),
    loadFocusOptions(workspaceId, initialProjectId),
  ]);

  const focusTaskId =
    conversation?.conversation.focus === "task"
      ? conversation.conversation.taskId
      : (requestedTask?.id ?? null);
  const focusTask = focusTaskId
    ? await prisma.task.findFirst({
        where: { id: focusTaskId, workspaceId },
        select: {
          description: true,
          priority: true,
          estimatedHours: true,
          startDate: true,
          dueDate: true,
        },
      })
    : null;
  const current = focusTask
    ? {
        description: focusTask.description,
        priority: focusTask.priority,
        estimatedHours: focusTask.estimatedHours,
        startDate: focusTask.startDate?.toISOString().slice(0, 10) ?? null,
        dueDate: focusTask.dueDate?.toISOString().slice(0, 10) ?? null,
      }
    : undefined;

  let focus: ChatFocusState = { kind: "none" };
  if (conversation?.conversation.focus === "task") {
    focus = {
      kind: "task",
      taskId: conversation.conversation.taskId,
      taskTitle: conversation.conversation.taskTitle,
      current,
    };
  } else if (requestedTask) {
    focus = { kind: "task", taskId: requestedTask.id, taskTitle: requestedTask.title, current };
  } else if (focusDocuments.length > 0) {
    focus = {
      kind: "documents",
      documents: focusDocuments.map((document) => ({
        id: document.id,
        filename: document.originalFilename,
      })),
    };
  }

  return (
    <ChatWorkspace
      // A new thread is keyed on its focus too, so moving between focuses
      // before the first question remounts rather than carrying state over.
      key={
        conversation?.conversation.id ??
        `new:${initialProjectId}:${focus.kind === "task" ? focus.taskId : ""}:${focusDocumentIds.join(",")}`
      }
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
      focus={focus}
      focusOptions={focusOptions}
      // Relative timestamps in the rail must come from one instant, or server
      // render and hydration disagree across a bucket boundary.
      nowIso={new Date().toISOString()}
    />
  );
}

/** Cap on picker entries; a longer list is a search problem, not a menu. */
const MAX_FOCUS_OPTIONS = 200;

/**
 * What the focus picker offers in the chosen scope: the project's official
 * tasks and ready documents, or — with no project — ready documents across the
 * workspace. A task needs a project, so none are offered without one.
 */
async function loadFocusOptions(
  workspaceId: string,
  projectId: string,
): Promise<FocusOptions> {
  const [tasks, documents] = await Promise.all([
    projectId
      ? prisma.task.findMany({
          where: officialRecordWhere({ workspaceId, projectId }),
          orderBy: { createdAt: "asc" },
          take: MAX_FOCUS_OPTIONS,
          select: { id: true, title: true },
        })
      : Promise.resolve([]),
    prisma.document.findMany({
      where: {
        workspaceId,
        status: "ready",
        ...(projectId ? { projectId } : {}),
      },
      orderBy: { originalFilename: "asc" },
      take: MAX_FOCUS_OPTIONS,
      select: { id: true, originalFilename: true },
    }),
  ]);
  return {
    tasks,
    documents: documents.map((document) => ({
      id: document.id,
      filename: document.originalFilename,
    })),
  };
}
