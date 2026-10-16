import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { officialRecordWhere } from "@/lib/pm/rules";
import { prepareTaskUpdate, updateTaskRecord } from "@/lib/pm/task-write";
import { updateTaskSchema } from "@/lib/schemas";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { workspaceId, user } = await requireWorkspace();
    const { id } = await params;

    const body = await request.json().catch(() => null);
    const parsed = updateTaskSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    // Shared with Capture's Apply (src/lib/pm/task-write.ts).
    const prepared = await prepareTaskUpdate(workspaceId, id, parsed.data);
    if (!prepared.ok) {
      return NextResponse.json({ error: prepared.error }, { status: prepared.status });
    }

    const task = await prisma.$transaction((tx) =>
      updateTaskRecord(tx, prepared.value, user.id),
    );
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
      where: officialRecordWhere({ id, workspaceId }),
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    await prisma.task.delete({ where: { id: existing.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "DELETE /api/tasks/[id]");
  }
}
