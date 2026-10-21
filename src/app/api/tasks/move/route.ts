import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { MoveTaskError, moveTasks } from "@/lib/pm/task-move";
import { moveTasksSchema } from "@/lib/schemas";

/**
 * Files tasks in another project, all or none. One request rather than one per
 * task, so dependencies between the tasks moved together survive the move.
 */
export async function POST(request: Request) {
  try {
    const access = await requireWorkspace();
    const body = await request.json().catch(() => null);
    const parsed = moveTasksSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const result = await moveTasks(access, parsed.data.taskIds, parsed.data.projectId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MoveTaskError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return handleRouteError(error, "POST /api/tasks/move");
  }
}
