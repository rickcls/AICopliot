import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { createTaskCommentSchema } from "@/lib/schemas";

/**
 * Discussion on one task.
 *
 * The task is resolved with `findFirst({ id, workspaceId })` before anything is
 * written, so a task ID from another workspace simply does not resolve and the
 * comment cannot be attached to it.
 *
 * Unlike the dependency routes this does **not** use `officialRecordWhere()`:
 * that predicate answers "has a human accepted this record", and a draft task
 * awaiting review is exactly the kind of thing reviewers need to discuss.
 */

interface Params {
  params: Promise<{ id: string }>;
}

export const COMMENT_SELECT = {
  id: true,
  body: true,
  createdAt: true,
  author: { select: { id: true, name: true, email: true } },
} as const;

export async function GET(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;

    const task = await prisma.task.findFirst({
      where: { id, workspaceId },
      select: { id: true },
    });
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const comments = await prisma.taskComment.findMany({
      where: { workspaceId, taskId: task.id },
      orderBy: { createdAt: "asc" },
      select: COMMENT_SELECT,
    });

    return NextResponse.json({ comments });
  } catch (error) {
    return handleRouteError(error, "GET /api/tasks/[id]/comments");
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { workspaceId, user } = await requireWorkspace();
    const { id } = await params;

    const body = await request.json().catch(() => null);
    const parsed = createTaskCommentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const task = await prisma.task.findFirst({
      where: { id, workspaceId },
      select: { id: true },
    });
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const comment = await prisma.taskComment.create({
      // The author is the session user, never a value from the request body:
      // otherwise a caller could post in somebody else's name.
      data: {
        workspaceId,
        taskId: task.id,
        authorId: user.id,
        body: parsed.data.body,
      },
      select: COMMENT_SELECT,
    });

    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "POST /api/tasks/[id]/comments");
  }
}
