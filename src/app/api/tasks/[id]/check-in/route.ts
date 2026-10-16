import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { checkInSchema } from "@/lib/schemas";
import { CheckInError, checkIn } from "@/lib/today/check-in";

interface Params {
  params: Promise<{ id: string }>;
}

/** Done, still working, blocked, or "ask me later" — one click from Today. */
export async function POST(request: Request, { params }: Params) {
  try {
    const access = await requireWorkspace();
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = checkInSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const result = await checkIn(access, id, parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CheckInError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return handleRouteError(error, "POST /api/tasks/[id]/check-in");
  }
}
