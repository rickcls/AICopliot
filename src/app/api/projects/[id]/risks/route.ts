import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireProject, requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { findOfficialProjectMilestone } from "@/lib/pm/project";
import { officialRecordWhere } from "@/lib/pm/rules";
import { riskSelect } from "@/lib/pm/select";
import { createRiskSchema } from "@/lib/schemas";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    const project = await requireProject(workspaceId, id);

    const risks = await prisma.projectRisk.findMany({
      where: officialRecordWhere({ workspaceId, projectId: project.id }),
      orderBy: { createdAt: "desc" },
      select: riskSelect,
    });

    return NextResponse.json({ risks });
  } catch (error) {
    return handleRouteError(error, "GET /api/projects/[id]/risks");
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    const project = await requireProject(workspaceId, id);

    const body = await request.json().catch(() => null);
    const parsed = createRiskSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
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

    const risk = await prisma.projectRisk.create({
      data: {
        workspaceId,
        projectId: project.id,
        milestoneId: parsed.data.milestoneId ?? null,
        description: parsed.data.description,
        impact: parsed.data.impact,
        likelihood: parsed.data.likelihood,
        mitigation: parsed.data.mitigation ?? null,
        status: parsed.data.status,
      },
      select: riskSelect,
    });

    return NextResponse.json({ risk }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "POST /api/projects/[id]/risks");
  }
}
