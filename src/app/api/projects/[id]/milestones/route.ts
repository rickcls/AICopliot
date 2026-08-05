import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireProject, requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { completedAtOnCreate, officialRecordWhere } from "@/lib/pm/rules";
import { milestoneSelect } from "@/lib/pm/select";
import { createMilestoneSchema } from "@/lib/schemas";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    const project = await requireProject(workspaceId, id);

    const milestones = await prisma.milestone.findMany({
      where: officialRecordWhere({ workspaceId, projectId: project.id }),
      orderBy: [{ targetDate: "asc" }, { createdAt: "asc" }],
      select: milestoneSelect,
    });

    return NextResponse.json({ milestones });
  } catch (error) {
    return handleRouteError(error, "GET /api/projects/[id]/milestones");
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    const project = await requireProject(workspaceId, id);

    const body = await request.json().catch(() => null);
    const parsed = createMilestoneSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const milestone = await prisma.milestone.create({
      data: {
        workspaceId,
        projectId: project.id,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        targetDate: parsed.data.targetDate ?? null,
        status: parsed.data.status,
        completedAt: completedAtOnCreate(parsed.data.status, "completed"),
      },
      select: milestoneSelect,
    });

    return NextResponse.json({ milestone }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "POST /api/projects/[id]/milestones");
  }
}
