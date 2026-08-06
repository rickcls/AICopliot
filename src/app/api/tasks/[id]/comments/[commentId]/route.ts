import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";

/**
 * Deleting one comment.
 *
 * The lookup constrains workspace, task, and comment together, so a comment ID
 * from another workspace — or one belonging to a different task than the URL
 * claims — does not resolve.
 *
 * Only the author may delete their own comment. Editing history out from under
 * the people who replied to it is not something another member should be able
 * to do quietly.
 */

interface Params {
  params: Promise<{ id: string; commentId: string }>;
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { workspaceId, user } = await requireWorkspace();
    const { id, commentId } = await params;

    const comment = await prisma.taskComment.findFirst({
      where: { id: commentId, taskId: id, workspaceId },
      select: { id: true, authorId: true },
    });
    if (!comment) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }
    if (comment.authorId !== user.id) {
      return NextResponse.json(
        { error: "You can only delete your own comments" },
        { status: 403 },
      );
    }

    await prisma.taskComment.delete({ where: { id: comment.id } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "DELETE /api/tasks/[id]/comments/[commentId]");
  }
}
