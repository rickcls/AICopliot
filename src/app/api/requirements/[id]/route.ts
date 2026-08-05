import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { recomputeRequirementRunStatus } from "@/lib/generation/requirements-service";
import { requirementGenerationStatusFor } from "@/lib/pm/rules";
import { requirementSelect } from "@/lib/pm/select";
import { updateRequirementSchema } from "@/lib/schemas";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { workspaceId, user } = await requireWorkspace();
    const { id } = await params;

    const body = await request.json().catch(() => null);
    const parsed = updateRequirementSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    // Deliberately NOT officialRecordWhere, unlike the task and risk item
    // routes: reviewing a draft proposal is exactly what this endpoint is for,
    // and that predicate would hide every row worth reviewing.
    const existing = await prisma.requirement.findFirst({
      where: { id, workspaceId },
      select: {
        id: true,
        source: true,
        generationStatus: true,
        generationRunId: true,
      },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Requirement not found" },
        { status: 404 },
      );
    }

    const data = parsed.data;
    const nextGenerationStatus = requirementGenerationStatusFor(
      existing.source,
      data.status,
    );
    const isReview =
      nextGenerationStatus !== undefined &&
      nextGenerationStatus !== existing.generationStatus;

    const requirement = await prisma.$transaction(async (tx) => {
      // Optimistic concurrency without a version column, the same pattern the
      // plan review uses: the observed generationStatus is part of the filter,
      // so a second reviewer's write finds nothing to update.
      const updated = await tx.requirement.updateMany({
        where: { id: existing.id, workspaceId, generationStatus: existing.generationStatus },
        data: {
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.description !== undefined
            ? { description: data.description }
            : {}),
          ...(data.type !== undefined ? { type: data.type } : {}),
          ...(data.priority !== undefined ? { priority: data.priority } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.acceptanceCriteria !== undefined
            ? { acceptanceCriteria: data.acceptanceCriteria }
            : {}),
          ...(data.assumptions !== undefined
            ? { assumptions: data.assumptions }
            : {}),
          ...(data.confidence !== undefined
            ? { confidence: data.confidence }
            : {}),
          ...(data.stakeholder !== undefined
            ? { stakeholder: data.stakeholder }
            : {}),
          ...(isReview
            ? {
                generationStatus: nextGenerationStatus,
                reviewedAt: new Date(),
                reviewedById: user.id,
              }
            : {}),
        },
      });
      if (updated.count !== 1) return null;

      if (isReview && existing.generationRunId) {
        await recomputeRequirementRunStatus(tx, existing.generationRunId);
      }

      return tx.requirement.findFirstOrThrow({
        where: { id: existing.id, workspaceId },
        select: requirementSelect,
      });
    });

    if (!requirement) {
      return NextResponse.json(
        { error: "This requirement was reviewed by someone else. Reload and try again." },
        { status: 409 },
      );
    }

    return NextResponse.json({ requirement });
  } catch (error) {
    return handleRouteError(error, "PATCH /api/requirements/[id]");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;

    const existing = await prisma.requirement.findFirst({
      where: { id, workspaceId },
      select: { id: true, generationRunId: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Requirement not found" },
        { status: 404 },
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.requirement.delete({ where: { id: existing.id } });
      if (existing.generationRunId) {
        await recomputeRequirementRunStatus(tx, existing.generationRunId);
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "DELETE /api/requirements/[id]");
  }
}
