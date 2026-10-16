import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import {
  COMMENT_SELECT,
  createTaskCommentRecord,
  findCommentableTask,
} from "@/lib/pm/task-write";
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

export async function GET(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;

    const task = await findCommentableTask(workspaceId, id);
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

    const task = await findCommentableTask(workspaceId, id);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // The author is the session user, never a value from the request body.
    const comment = await createTaskCommentRecord(prisma, {
      workspaceId,
      taskId: task.id,
      authorId: user.id,
      body: parsed.data.body,
    });

    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "POST /api/tasks/[id]/comments");
  }
}
