import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireProject, requireWorkspace } from "@/lib/auth-guard";
import {
  generateRequirements,
  getRequirementRuns,
} from "@/lib/generation/requirements-service";
import { createRequirementRunSchema } from "@/lib/generation/schemas";
import { GenerationRequestError } from "@/lib/generation/service";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    const project = await requireProject(workspaceId, id);
    const runs = await getRequirementRuns(workspaceId, project.id);
    return NextResponse.json({ runs });
  } catch (error) {
    return handleRouteError(error, "GET /api/projects/[id]/requirement-runs");
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { workspaceId, userId } = await requireWorkspace();
    const { id } = await params;
    const project = await requireProject(workspaceId, id);
    const body = await request.json().catch(() => null);
    const parsed = createRequirementRunSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const run = await generateRequirements({
      workspaceId,
      projectId: project.id,
      userId,
      documentIds: parsed.data.documentIds,
    });
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    if (error instanceof GenerationRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return handleRouteError(error, "POST /api/projects/[id]/requirement-runs");
  }
}
