import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace, requireWorkspaceMember } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { findOfficialProjectMilestone } from "@/lib/pm/project";
import {
  completedAtOnStatusChange,
  DONE_TASK_CATEGORY,
  officialRecordWhere,
} from "@/lib/pm/rules";
import { taskSelect } from "@/lib/pm/select";
import { resolveTaskRelations } from "@/lib/pm/task-relations";
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

    const existing = await prisma.task.findFirst({
      where: officialRecordWhere({ id, workspaceId }),
      select: {
        id: true,
        projectId: true,
        statusId: true,
        status: { select: { category: true } },
        startDate: true,
        dueDate: true,
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (parsed.data.assigneeId) {
      await requireWorkspaceMember(workspaceId, parsed.data.assigneeId);
    }
    if (parsed.data.milestoneId) {
      const milestone = await findOfficialProjectMilestone(
        workspaceId,
        existing.projectId,
        parsed.data.milestoneId,
      );
      if (!milestone) {
        return NextResponse.json(
          { error: "Milestone not found in this project" },
          { status: 404 },
        );
      }
    }

    const data = parsed.data;

    const nextStart =
      data.startDate !== undefined ? data.startDate : existing.startDate;
    const nextDue = data.dueDate !== undefined ? data.dueDate : existing.dueDate;
    if (nextStart && nextDue && nextStart.getTime() > nextDue.getTime()) {
      return NextResponse.json(
        { error: "Start date must be on or before the due date" },
        { status: 400 },
      );
    }

    let nextCategory = existing.status.category;
    if (data.statusId !== undefined && data.statusId !== existing.statusId) {
      const status = await prisma.projectTaskStatus.findFirst({
        where: {
          id: data.statusId,
          workspaceId,
          projectId: existing.projectId,
        },
        select: { id: true, category: true },
      });
      if (!status) {
        return NextResponse.json(
          { error: "Status not found in this project" },
          { status: 404 },
        );
      }
      nextCategory = status.category;
    }

    const relations = await resolveTaskRelations(
      workspaceId,
      existing.projectId,
      data,
    );
    if (!relations.ok) {
      return NextResponse.json({ error: relations.error }, { status: 404 });
    }
    const { documentIds, citations, requirementIds } = relations.value;

    const completedAt = completedAtOnStatusChange(
      existing.status.category,
      data.statusId !== undefined ? nextCategory : undefined,
      DONE_TASK_CATEGORY,
    );

    const task = await prisma.$transaction(async (tx) => {
      // Documents are a set the form states in full; citations and requirement
      // links only accumulate here — each has its own place to be removed.
      if (documentIds !== undefined) {
        await tx.taskDocument.deleteMany({
          where: { taskId: existing.id, documentId: { notIn: documentIds } },
        });
        await tx.taskDocument.createMany({
          data: documentIds.map((documentId) => ({
            workspaceId,
            taskId: existing.id,
            documentId,
          })),
          skipDuplicates: true,
        });
      }
      if (citations.length > 0) {
        await tx.taskCitation.createMany({
          data: citations.map((citation) => ({
            workspaceId,
            taskId: existing.id,
            documentChunkId: citation.documentChunkId,
            excerpt: citation.excerpt,
            purpose: "proposal" as const,
          })),
          skipDuplicates: true,
        });
      }
      if (requirementIds.length > 0) {
        await tx.requirementLink.createMany({
          data: requirementIds.map((requirementId) => ({
            workspaceId,
            requirementId,
            targetType: "task" as const,
            taskId: existing.id,
            createdById: user.id,
          })),
          skipDuplicates: true,
        });
      }

      return tx.task.update({
      where: { id: existing.id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.statusId !== undefined ? { statusId: data.statusId } : {}),
        ...(data.priority !== undefined ? { priority: data.priority } : {}),
        ...(data.assigneeId !== undefined
          ? { assigneeId: data.assigneeId }
          : {}),
        ...(data.milestoneId !== undefined
          ? { milestoneId: data.milestoneId }
          : {}),
        ...(data.estimatedHours !== undefined
          ? { estimatedHours: data.estimatedHours }
          : {}),
        ...(data.startDate !== undefined ? { startDate: data.startDate } : {}),
        ...(data.dueDate !== undefined ? { dueDate: data.dueDate } : {}),
        ...(completedAt !== undefined ? { completedAt } : {}),
      },
      select: taskSelect,
      });
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
