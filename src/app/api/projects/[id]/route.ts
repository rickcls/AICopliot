import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { updateProjectSchema } from "@/lib/schemas";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = updateProjectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const project = await prisma.project.findFirst({
      where: { id, workspaceId },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (parsed.data.name) {
      const duplicate = await prisma.project.findFirst({
        where: {
          workspaceId,
          name: parsed.data.name,
          NOT: { id: project.id },
        },
        select: { id: true },
      });
      if (duplicate) {
        return NextResponse.json(
          { error: "A project with that name already exists" },
          { status: 409 },
        );
      }
    }

    const updated = await prisma.project.update({
      where: { id: project.id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.description !== undefined
          ? { description: parsed.data.description || null }
          : {}),
      },
      include: { _count: { select: { documents: true } } },
    });

    return NextResponse.json({ project: updated });
  } catch (error) {
    return handleRouteError(error, "PATCH /api/projects/[id]");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    const project = await prisma.project.findFirst({
      where: { id, workspaceId },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Project relations use SET NULL so deleting a project never deletes its
    // documents, conversations, or evaluation history.
    await prisma.project.delete({ where: { id: project.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "DELETE /api/projects/[id]");
  }
}
