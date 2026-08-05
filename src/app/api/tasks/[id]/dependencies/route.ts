import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import {
  officialRecordWhere,
  validateDependency,
  wouldCreateDependencyCycle,
} from "@/lib/pm/rules";
import { createTaskDependencySchema } from "@/lib/schemas";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;

    const body = await request.json().catch(() => null);
    const parsed = createTaskDependencySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const task = await prisma.task.findFirst({
      where: officialRecordWhere({ id, workspaceId }),
      select: {
        id: true,
        projectId: true,
        dependencies: {
          where: officialRecordWhere({}),
          select: { dependsOnTaskId: true },
        },
      },
    });
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // The dependency target is resolved under the same workspace constraint, so
    // a task ID from elsewhere cannot be linked into this project's graph.
    const target = await prisma.task.findFirst({
      where: officialRecordWhere({
        id: parsed.data.dependsOnTaskId,
        workspaceId,
      }),
      select: { id: true, projectId: true },
    });

    const check = validateDependency({
      taskId: task.id,
      dependsOnTaskId: parsed.data.dependsOnTaskId,
      sameProject: target !== null && target.projectId === task.projectId,
      existingDependsOnIds: task.dependencies.map((d) => d.dependsOnTaskId),
    });
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const projectEdges = await prisma.taskDependency.findMany({
      where: officialRecordWhere({
        workspaceId,
        task: { projectId: task.projectId },
      }),
      select: { taskId: true, dependsOnTaskId: true },
    });
    if (
      wouldCreateDependencyCycle(projectEdges, {
        taskId: task.id,
        dependsOnTaskId: parsed.data.dependsOnTaskId,
      })
    ) {
      return NextResponse.json(
        { error: "That dependency would create a cycle" },
        { status: 409 },
      );
    }

    const dependency = await prisma.taskDependency.create({
      data: {
        workspaceId,
        taskId: task.id,
        dependsOnTaskId: parsed.data.dependsOnTaskId,
      },
      select: {
        id: true,
        dependsOnTaskId: true,
        source: true,
        generationStatus: true,
        dependsOnTask: { select: { title: true, status: true } },
        citations: {
          select: {
            id: true,
            excerpt: true,
            chunk: {
              select: {
                id: true,
                pageNumber: true,
                sectionTitle: true,
                document: {
                  select: { id: true, originalFilename: true },
                },
              },
            },
          },
        },
      },
    });

    return NextResponse.json({ dependency }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "POST /api/tasks/[id]/dependencies");
  }
}
