import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { officialRecordWhere } from "@/lib/pm/rules";
import { taskSelect } from "@/lib/pm/select";

interface Params {
  params: Promise<{ id: string; documentId: string }>;
}

/**
 * Unlinks a document from a task. The document itself stays in the project:
 * it is shared knowledge, and deleting it belongs to the Documents tab.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id, documentId } = await params;

    const task = await prisma.task.findFirst({
      where: officialRecordWhere({ id, workspaceId }),
      select: { id: true },
    });
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    await prisma.taskDocument.deleteMany({
      where: { workspaceId, taskId: task.id, documentId },
    });

    const updated = await prisma.task.findFirstOrThrow({
      where: { id: task.id, workspaceId },
      select: taskSelect,
    });
    return NextResponse.json({ task: updated });
  } catch (error) {
    return handleRouteError(error, "DELETE /api/tasks/[id]/documents/[documentId]");
  }
}
