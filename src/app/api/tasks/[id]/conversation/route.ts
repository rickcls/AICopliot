import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { loadConversation } from "@/lib/chat/history";
import { prisma } from "@/lib/db";
import { officialRecordWhere } from "@/lib/pm/rules";

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * The caller's most recent thread about this task, with its turns, or null.
 *
 * Threads are per person, like every chat thread: two people asking about the
 * same task each have their own conversation. The task panel opens on the
 * latest one; older ones stay in the main chat's thread list.
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { workspaceId, user } = await requireWorkspace();
    const { id } = await params;

    const task = await prisma.task.findFirst({
      where: officialRecordWhere({ id, workspaceId }),
      select: { id: true },
    });
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const latest = await prisma.chatConversation.findFirst({
      where: { workspaceId, userId: user.id, taskId: task.id, focus: "task" },
      orderBy: { lastMessageAt: "desc" },
      select: { id: true },
    });
    const conversation = latest
      ? await loadConversation(workspaceId, user.id, latest.id)
      : null;
    return NextResponse.json({ conversation });
  } catch (error) {
    return handleRouteError(error, "GET /api/tasks/[id]/conversation");
  }
}
