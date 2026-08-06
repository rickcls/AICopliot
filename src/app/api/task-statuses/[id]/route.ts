import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { taskStatusSelect } from "@/lib/pm/select";
import { updateTaskStatusSchema } from "@/lib/schemas";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;

    const body = await request.json().catch(() => null);
    const parsed = updateTaskStatusSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const existing = await prisma.projectTaskStatus.findFirst({
      where: { id, workspaceId },
      select: {
        id: true,
        projectId: true,
        category: true,
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Status not found" }, { status: 404 });
    }

    const data = parsed.data;

    // Changing category away from the last open/done column would leave the
    // board without a place for new work or a terminal state.
    if (data.category !== undefined && data.category !== existing.category) {
      const siblings = await prisma.projectTaskStatus.findMany({
        where: { workspaceId, projectId: existing.projectId },
        select: { id: true, category: true },
      });
      const nextCategories = siblings.map((row) =>
        row.id === existing.id ? data.category! : row.category,
      );
      if (!nextCategories.includes("open")) {
        return NextResponse.json(
          { error: "Keep at least one Open status" },
          { status: 400 },
        );
      }
      if (!nextCategories.includes("done")) {
        return NextResponse.json(
          { error: "Keep at least one Done status" },
          { status: 400 },
        );
      }
    }

    const status = await prisma.$transaction(async (tx) => {
      if (data.isDefault === true) {
        await tx.projectTaskStatus.updateMany({
          where: {
            workspaceId,
            projectId: existing.projectId,
            NOT: { id: existing.id },
          },
          data: { isDefault: false },
        });
      }

      return tx.projectTaskStatus.update({
        where: { id: existing.id },
        data: {
          ...(data.label !== undefined ? { label: data.label } : {}),
          ...(data.category !== undefined ? { category: data.category } : {}),
          ...(data.color !== undefined ? { color: data.color } : {}),
          ...(data.isDefault !== undefined
            ? { isDefault: data.isDefault }
            : {}),
        },
        select: taskStatusSelect,
      });
    });

    return NextResponse.json({ status });
  } catch (error) {
    return handleRouteError(error, "PATCH /api/task-statuses/[id]");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;

    const existing = await prisma.projectTaskStatus.findFirst({
      where: { id, workspaceId },
      select: {
        id: true,
        projectId: true,
        category: true,
        label: true,
        _count: { select: { tasks: true } },
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Status not found" }, { status: 404 });
    }

    if (existing._count.tasks > 0) {
      return NextResponse.json(
        {
          error: `Move or delete the ${existing._count.tasks} task${
            existing._count.tasks === 1 ? "" : "s"
          } in “${existing.label}” first`,
        },
        { status: 409 },
      );
    }

    const siblings = await prisma.projectTaskStatus.findMany({
      where: {
        workspaceId,
        projectId: existing.projectId,
        NOT: { id: existing.id },
      },
      select: { category: true },
    });
    if (!siblings.some((row) => row.category === "open")) {
      return NextResponse.json(
        { error: "Keep at least one Open status" },
        { status: 400 },
      );
    }
    if (!siblings.some((row) => row.category === "done")) {
      return NextResponse.json(
        { error: "Keep at least one Done status" },
        { status: 400 },
      );
    }

    await prisma.projectTaskStatus.delete({ where: { id: existing.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "DELETE /api/task-statuses/[id]");
  }
}
