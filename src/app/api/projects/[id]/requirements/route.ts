import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireProject, requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { requirementSelect } from "@/lib/pm/select";
import { createRequirementSchema } from "@/lib/schemas";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    const project = await requireProject(workspaceId, id);

    // Unlike the delivery records, the register lists drafts too: an unconfirmed
    // requirement is the thing a consultant works from. See invariant 14.
    const requirements = await prisma.requirement.findMany({
      where: { workspaceId, projectId: project.id },
      orderBy: { sequence: "asc" },
      select: requirementSelect,
    });

    return NextResponse.json({ requirements });
  } catch (error) {
    return handleRouteError(error, "GET /api/projects/[id]/requirements");
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    const project = await requireProject(workspaceId, id);

    const body = await request.json().catch(() => null);
    const parsed = createRequirementSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const data = parsed.data;
    // Two concurrent creates can read the same MAX(sequence); the unique index
    // rejects the loser, and one retry re-reads the now-higher value.
    let requirement;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        requirement = await prisma.$transaction(async (tx) => {
          const highest = await tx.requirement.aggregate({
            where: { projectId: project.id },
            _max: { sequence: true },
          });
          return tx.requirement.create({
            data: {
              workspaceId,
              projectId: project.id,
              sequence: (highest._max.sequence ?? 0) + 1,
              title: data.title,
              description: data.description ?? null,
              type: data.type,
              priority: data.priority,
              status: data.status,
              acceptanceCriteria: data.acceptanceCriteria ?? null,
              assumptions: data.assumptions ?? null,
              confidence: data.confidence,
              stakeholder: data.stakeholder ?? null,
            },
            select: requirementSelect,
          });
        });
        break;
      } catch (error) {
        const isSequenceCollision =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code?: unknown }).code === "P2002";
        if (!isSequenceCollision || attempt === 1) throw error;
      }
    }

    return NextResponse.json({ requirement }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "POST /api/projects/[id]/requirements");
  }
}
