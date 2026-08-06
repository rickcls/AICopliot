import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireProject, requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { taskStatusSelect } from "@/lib/pm/select";
import {
  categoryTone,
  slugifyStatusKey,
} from "@/lib/pm/task-statuses";
import { createTaskStatusSchema } from "@/lib/schemas";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    const project = await requireProject(workspaceId, id);

    const statuses = await prisma.projectTaskStatus.findMany({
      where: { workspaceId, projectId: project.id },
      orderBy: { position: "asc" },
      select: taskStatusSelect,
    });

    return NextResponse.json({ statuses });
  } catch (error) {
    return handleRouteError(error, "GET /api/projects/[id]/task-statuses");
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    const project = await requireProject(workspaceId, id);

    const body = await request.json().catch(() => null);
    const parsed = createTaskStatusSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const existing = await prisma.projectTaskStatus.findMany({
      where: { workspaceId, projectId: project.id },
      select: { key: true, position: true },
    });
    const taken = new Set(existing.map((row) => row.key));
    const maxPosition = existing.reduce(
      (max, row) => Math.max(max, row.position),
      -1,
    );

    const status = await prisma.projectTaskStatus.create({
      data: {
        workspaceId,
        projectId: project.id,
        key: slugifyStatusKey(parsed.data.label, taken),
        label: parsed.data.label,
        category: parsed.data.category,
        position: maxPosition + 1,
        color: parsed.data.color ?? categoryTone(parsed.data.category),
        isDefault: false,
      },
      select: taskStatusSelect,
    });

    return NextResponse.json({ status }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "POST /api/projects/[id]/task-statuses");
  }
}
