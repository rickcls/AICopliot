import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireProject, requireWorkspace } from "@/lib/auth-guard";
import {
  generateProjectPlan,
  GenerationRequestError,
  getProjectPlanRuns,
} from "@/lib/generation/service";
import { createGenerationRunSchema } from "@/lib/generation/schemas";

/** Hobby plan ceiling. Plan generation waits on a model call. */
export const maxDuration = 60;

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    const project = await requireProject(workspaceId, id);
    const runs = await getProjectPlanRuns(workspaceId, project.id);
    return NextResponse.json({ runs });
  } catch (error) {
    return handleRouteError(error, "GET /api/projects/[id]/generation-runs");
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { workspaceId, userId } = await requireWorkspace();
    const { id } = await params;
    const project = await requireProject(workspaceId, id);
    const body = await request.json().catch(() => null);
    const parsed = createGenerationRunSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const run = await generateProjectPlan({
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
    return handleRouteError(error, "POST /api/projects/[id]/generation-runs");
  }
}
