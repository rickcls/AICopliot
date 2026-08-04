import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";

interface Params {
  params: Promise<{ id: string; dependencyId: string }>;
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id, dependencyId } = await params;

    // Constrained on all three: the dependency row, its owning task, and the
    // workspace. A dependency ID borrowed from another task does not resolve.
    const dependency = await prisma.taskDependency.findFirst({
      where: { id: dependencyId, taskId: id, workspaceId },
      select: { id: true },
    });
    if (!dependency) {
      return NextResponse.json(
        { error: "Dependency not found" },
        { status: 404 },
      );
    }

    await prisma.taskDependency.delete({ where: { id: dependency.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(
      error,
      "DELETE /api/tasks/[id]/dependencies/[dependencyId]",
    );
  }
}
