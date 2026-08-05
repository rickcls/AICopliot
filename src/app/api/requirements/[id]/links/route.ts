import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { officialRecordWhere } from "@/lib/pm/rules";
import { requirementSelect } from "@/lib/pm/select";
import { createRequirementLinkSchema } from "@/lib/schemas";

interface Params {
  params: Promise<{ id: string }>;
}

/** Resolves a link target inside the workspace and project, or null. */
async function findOfficialTarget(
  targetType: "task" | "milestone" | "risk",
  workspaceId: string,
  projectId: string,
  targetId: string,
) {
  const where = officialRecordWhere({ id: targetId, workspaceId, projectId });
  const select = { id: true };
  if (targetType === "task") {
    return prisma.task.findFirst({ where, select });
  }
  if (targetType === "milestone") {
    return prisma.milestone.findFirst({ where, select });
  }
  return prisma.projectRisk.findFirst({ where, select });
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { workspaceId, user } = await requireWorkspace();
    const { id } = await params;

    const body = await request.json().catch(() => null);
    const parsed = createRequirementLinkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const requirement = await prisma.requirement.findFirst({
      where: { id, workspaceId },
      select: { id: true, projectId: true },
    });
    if (!requirement) {
      return NextResponse.json(
        { error: "Requirement not found" },
        { status: 404 },
      );
    }

    const { targetType, targetId } = parsed.data;
    // Only official records may be linked, so a coverage count can never be
    // satisfied by a draft or rejected proposal.
    const target = await findOfficialTarget(
      targetType,
      workspaceId,
      requirement.projectId,
      targetId,
    );
    if (!target) {
      return NextResponse.json(
        { error: `No official ${targetType} with that ID exists in this project` },
        { status: 404 },
      );
    }

    const existing = await prisma.requirementLink.findFirst({
      where: {
        workspaceId,
        requirementId: requirement.id,
        ...(targetType === "task" ? { taskId: target.id } : {}),
        ...(targetType === "milestone" ? { milestoneId: target.id } : {}),
        ...(targetType === "risk" ? { riskId: target.id } : {}),
      },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: "That record is already linked to this requirement" },
        { status: 409 },
      );
    }

    await prisma.requirementLink.create({
      data: {
        workspaceId,
        requirementId: requirement.id,
        targetType,
        taskId: targetType === "task" ? target.id : null,
        milestoneId: targetType === "milestone" ? target.id : null,
        riskId: targetType === "risk" ? target.id : null,
        createdById: user.id,
      },
      select: { id: true },
    });

    // Return the whole requirement so the panel replaces the row in place and
    // its coverage chip stays consistent with the list it came from.
    const updated = await prisma.requirement.findFirstOrThrow({
      where: { id: requirement.id, workspaceId },
      select: requirementSelect,
    });
    return NextResponse.json({ requirement: updated }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "POST /api/requirements/[id]/links");
  }
}
