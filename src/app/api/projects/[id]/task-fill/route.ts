import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireProject, requireWorkspace } from "@/lib/auth-guard";
import { GenerationRequestError } from "@/lib/generation/service";
import { fillTask } from "@/lib/generation/task-fill-service";
import { taskFillSchema } from "@/lib/schemas";

/** Hobby plan ceiling. A fill waits on one model call, two if it needs a repair. */
export const maxDuration = 60;

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Proposes values for a task's blank fields. Nested under the project because
 * the evidence is the project's documents; it writes nothing, so it works the
 * same for a task that does not exist yet.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    const project = await requireProject(workspaceId, id);

    const body = await request.json().catch(() => null);
    const parsed = taskFillSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const result = await fillTask({
      workspaceId,
      projectId: project.id,
      title: parsed.data.title,
      description: parsed.data.description,
      documentIds: parsed.data.documentIds,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof GenerationRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return handleRouteError(error, "POST /api/projects/[id]/task-fill");
  }
}
