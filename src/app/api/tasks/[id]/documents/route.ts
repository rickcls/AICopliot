import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { officialRecordWhere } from "@/lib/pm/rules";
import { taskSelect } from "@/lib/pm/select";
import { linkTaskDocumentSchema } from "@/lib/schemas";

interface Params {
  params: Promise<{ id: string }>;
}

/** Links one project document to a task, from the detail panel. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;

    const body = await request.json().catch(() => null);
    const parsed = linkTaskDocumentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const task = await prisma.task.findFirst({
      where: officialRecordWhere({ id, workspaceId }),
      select: { id: true, projectId: true },
    });
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Resolved inside the task's own project, so a document id from another
    // project or workspace simply does not match.
    const document = await prisma.document.findFirst({
      where: {
        id: parsed.data.documentId,
        workspaceId,
        projectId: task.projectId,
      },
      select: { id: true },
    });
    if (!document) {
      return NextResponse.json(
        { error: "Document not found in this project" },
        { status: 404 },
      );
    }

    await prisma.taskDocument.createMany({
      data: [{ workspaceId, taskId: task.id, documentId: document.id }],
      skipDuplicates: true,
    });

    const updated = await prisma.task.findFirstOrThrow({
      where: { id: task.id, workspaceId },
      select: taskSelect,
    });
    return NextResponse.json({ task: updated }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "POST /api/tasks/[id]/documents");
  }
}
