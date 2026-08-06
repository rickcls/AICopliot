import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import {
  requireProject,
  requireWorkspace,
  requireWorkspaceMember,
} from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { findOfficialProjectMilestone } from "@/lib/pm/project";
import {
  completedAtOnCreate,
  DONE_TASK_CATEGORY,
  officialRecordWhere,
} from "@/lib/pm/rules";
import { taskSelect } from "@/lib/pm/select";
import { createTaskSchema } from "@/lib/schemas";

interface Params {
  params: Promise<{ id: string }>;
}

async function resolveProjectStatus(
  workspaceId: string,
  projectId: string,
  statusId: string | undefined,
) {
  if (statusId) {
    return prisma.projectTaskStatus.findFirst({
      where: { id: statusId, workspaceId, projectId },
      select: { id: true, category: true },
    });
  }

  const fallback = await prisma.projectTaskStatus.findFirst({
    where: { workspaceId, projectId, isDefault: true },
    select: { id: true, category: true },
  });
  if (fallback) return fallback;

  return prisma.projectTaskStatus.findFirst({
    where: { workspaceId, projectId },
    orderBy: { position: "asc" },
    select: { id: true, category: true },
  });
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
    const { workspaceId } = await requireWorkspace();
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

    if (parsed.data.assigneeId) {
      await requireWorkspaceMember(workspaceId, parsed.data.assigneeId);
    }
    if (parsed.data.milestoneId) {
      const milestone = await findOfficialProjectMilestone(
        workspaceId,
        project.id,
        parsed.data.milestoneId,
      );
      if (!milestone) {
        return NextResponse.json(
          { error: "Milestone not found in this project" },
          { status: 404 },
        );
      }
    }

    const status = await resolveProjectStatus(
      workspaceId,
      project.id,
      parsed.data.statusId,
    );
    if (!status) {
      return NextResponse.json(
        { error: "Status not found in this project" },
        { status: 404 },
      );
    }

    const now = new Date();

    const task = await prisma.task.create({
      data: {
        workspaceId,
        projectId: project.id,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        statusId: status.id,
        priority: parsed.data.priority,
        assigneeId: parsed.data.assigneeId ?? null,
        milestoneId: parsed.data.milestoneId ?? null,
        estimatedHours: parsed.data.estimatedHours ?? null,
        startDate: parsed.data.startDate ?? null,
        dueDate: parsed.data.dueDate ?? null,
        completedAt: completedAtOnCreate(
          status.category,
          DONE_TASK_CATEGORY,
          now,
        ),
      },
      select: taskSelect,
    });

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "POST /api/projects/[id]/tasks");
  }
}
