import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { requirementSelect } from "@/lib/pm/select";

interface Params {
  params: Promise<{ id: string; linkId: string }>;
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id, linkId } = await params;

    // Constrains workspace, requirement, and link together, so a link ID from
    // another requirement or workspace simply does not resolve.
    const existing = await prisma.requirementLink.findFirst({
      where: { id: linkId, workspaceId, requirementId: id },
      select: { id: true, requirementId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Link not found" }, { status: 404 });
    }

    await prisma.requirementLink.delete({ where: { id: existing.id } });

    const requirement = await prisma.requirement.findFirstOrThrow({
      where: { id: existing.requirementId, workspaceId },
      select: requirementSelect,
    });
    return NextResponse.json({ requirement });
  } catch (error) {
    return handleRouteError(error, "DELETE /api/requirements/[id]/links/[linkId]");
  }
}
