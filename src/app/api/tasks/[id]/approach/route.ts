import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { ApproachError, getLatestApproach, suggestApproach } from "@/lib/approach/service";
import { requireWorkspace } from "@/lib/auth-guard";

export const maxDuration = 60;

interface Params {
  params: Promise<{ id: string }>;
}

/** The caller's latest suggested approach for this task, or null. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const access = await requireWorkspace();
    const { id } = await params;
    return NextResponse.json({ approach: await getLatestApproach(access, id) });
  } catch (error) {
    return handleRouteError(error, "GET /api/tasks/[id]/approach");
  }
}

/** Asks for a new suggested approach. Changes nothing on the task. */
export async function POST(_request: Request, { params }: Params) {
  try {
    const access = await requireWorkspace();
    const { id } = await params;
    return NextResponse.json({ approach: await suggestApproach(access, id) }, { status: 201 });
  } catch (error) {
    if (error instanceof ApproachError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return handleRouteError(error, "POST /api/tasks/[id]/approach");
  }
}
