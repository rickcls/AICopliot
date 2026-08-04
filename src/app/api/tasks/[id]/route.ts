import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace, requireWorkspaceMember } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { taskSelect } from "@/lib/pm/select";
import { updateTaskSchema } from "@/lib/schemas";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;

    const body = await request.json().catch(() => null);
    const parsed = updateTaskSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    // findFirst on (id, workspaceId): a task ID from another workspace does not
    // resolve, so the update below can only ever touch our own row.
    const existing = await prisma.task.findFirst({
      where: { id, workspaceId },
      select: { id: true, startDate: true, dueDate: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (parsed.data.assigneeId) {
      await requireWorkspaceMember(workspaceId, parsed.data.assigneeId);
    }

    const data = parsed.data;

    // The schema can only compare dates that arrive together. Moving just one
    // of them has to be checked against what is already stored, or a task could
    // end up finishing before it starts.
    const nextStart =
      data.startDate !== undefined ? data.startDate : existing.startDate;
    const nextDue = data.dueDate !== undefined ? data.dueDate : existing.dueDate;
    if (nextStart && nextDue && nextStart.getTime() > nextDue.getTime()) {
      return NextResponse.json(
        { error: "Start date must be on or before the due date" },
        { status: 400 },
      );
    }

    const task = await prisma.task.update({
      where: { id: existing.id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.priority !== undefined ? { priority: data.priority } : {}),
        ...(data.assigneeId !== undefined
          ? { assigneeId: data.assigneeId }
          : {}),
        ...(data.estimatedHours !== undefined
          ? { estimatedHours: data.estimatedHours }
          : {}),
        ...(data.startDate !== undefined ? { startDate: data.startDate } : {}),
        ...(data.dueDate !== undefined ? { dueDate: data.dueDate } : {}),
      },
      select: taskSelect,
    });

    return NextResponse.json({ task });
  } catch (error) {
    return handleRouteError(error, "PATCH /api/tasks/[id]");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;

    const existing = await prisma.task.findFirst({
      where: { id, workspaceId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Dependencies in both directions cascade with the row.
    await prisma.task.delete({ where: { id: existing.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "DELETE /api/tasks/[id]");
  }
}
