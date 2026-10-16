import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireProject, requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { officialRecordWhere } from "@/lib/pm/rules";
import { taskSelect } from "@/lib/pm/select";
import { createTaskRecord, prepareTaskCreate } from "@/lib/pm/task-write";
import { createTaskSchema } from "@/lib/schemas";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    const project = await requireProject(workspaceId, id);

    const tasks = await prisma.task.findMany({
      where: officialRecordWhere({ workspaceId, projectId: project.id }),
      orderBy: [{ createdAt: "asc" }],
      select: taskSelect,
    });

    return NextResponse.json({ tasks });
  } catch (error) {
    return handleRouteError(error, "GET /api/projects/[id]/tasks");
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { workspaceId, user } = await requireWorkspace();
    const { id } = await params;
    const project = await requireProject(workspaceId, id);

    const body = await request.json().catch(() => null);
    const parsed = createTaskSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    // Validation and the write live in task-write.ts, shared with Capture's
    // Apply, so a captured task is checked exactly like a typed one.
    const prepared = await prepareTaskCreate(workspaceId, project.id, parsed.data);
    if (!prepared.ok) {
      return NextResponse.json({ error: prepared.error }, { status: prepared.status });
    }

    const task = await createTaskRecord(prisma, prepared.value, user.id);
    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "POST /api/projects/[id]/tasks");
  }
}
