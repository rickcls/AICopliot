import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { ApproachError, createTasksFromSteps } from "@/lib/approach/service";
import { requireWorkspace } from "@/lib/auth-guard";
import { getT } from "@/lib/i18n/server";
import { createTasksFromStepsSchema } from "@/lib/schemas";

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Creates a task per chosen step, which the original task then depends on. A
 * step already turned into a task is skipped. `parent` is the original task
 * read back with its new dependencies.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const access = await requireWorkspace();
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = createTasksFromStepsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Choose at least one step" }, { status: 400 });
    }
    const t = await getT();
    const { tasks, parent } = await createTasksFromSteps(
      access,
      id,
      parsed.data.stepIndexes,
      t("approach.generalMarker"),
    );
    return NextResponse.json({ tasks, parent }, { status: 201 });
  } catch (error) {
    if (error instanceof ApproachError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return handleRouteError(error, "POST /api/task-suggestions/[id]/create-tasks");
  }
}
