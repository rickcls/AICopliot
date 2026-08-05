import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { findOfficialProjectMilestone } from "@/lib/pm/project";
import { officialRecordWhere } from "@/lib/pm/rules";
import { riskSelect } from "@/lib/pm/select";
import { updateRiskSchema } from "@/lib/schemas";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;

    const body = await request.json().catch(() => null);
    const parsed = updateRiskSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const existing = await prisma.projectRisk.findFirst({
      where: officialRecordWhere({ id, workspaceId }),
      select: { id: true, projectId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Risk not found" }, { status: 404 });
    }

    const data = parsed.data;
    if (data.milestoneId) {
      const milestone = await findOfficialProjectMilestone(
        workspaceId,
        existing.projectId,
        data.milestoneId,
      );
      if (!milestone) {
        return NextResponse.json(
          { error: "Milestone not found in this project" },
          { status: 404 },
        );
      }
    }
    const risk = await prisma.projectRisk.update({
      where: { id: existing.id },
      data: {
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.milestoneId !== undefined
          ? { milestoneId: data.milestoneId }
          : {}),
        ...(data.impact !== undefined ? { impact: data.impact } : {}),
        ...(data.likelihood !== undefined
          ? { likelihood: data.likelihood }
          : {}),
        ...(data.mitigation !== undefined
          ? { mitigation: data.mitigation }
          : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
      select: riskSelect,
    });

    return NextResponse.json({ risk });
  } catch (error) {
    return handleRouteError(error, "PATCH /api/risks/[id]");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;

    const existing = await prisma.projectRisk.findFirst({
      where: officialRecordWhere({ id, workspaceId }),
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Risk not found" }, { status: 404 });
    }

    await prisma.projectRisk.delete({ where: { id: existing.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "DELETE /api/risks/[id]");
  }
}
