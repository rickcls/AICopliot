import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { dayPlanRequestSchema } from "@/lib/schemas";
import { DayPlanError, planMyDay } from "@/lib/today/plan-service";

export const maxDuration = 60;

/** Suggests an order for today's work within the hours given. Changes no task. */
export async function POST(request: Request) {
  try {
    const access = await requireWorkspace();
    const body = await request.json().catch(() => null);
    const parsed = dayPlanRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }
    const plan = await planMyDay(access, parsed.data);
    return NextResponse.json({ plan });
  } catch (error) {
    if (error instanceof DayPlanError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return handleRouteError(error, "POST /api/today/plan");
  }
}
