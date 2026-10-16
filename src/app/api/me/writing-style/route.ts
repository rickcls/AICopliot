import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireUser } from "@/lib/auth-guard";
import { getWritingStyle, saveWritingStyle } from "@/lib/email/service";
import { writingStyleSchema } from "@/lib/schemas";

/** The caller's own writing samples, tone description, and signature. */
export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ style: await getWritingStyle(user.id) });
  } catch (error) {
    return handleRouteError(error, "GET /api/me/writing-style");
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json().catch(() => null);
    const parsed = writingStyleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }
    return NextResponse.json({ style: await saveWritingStyle(user.id, parsed.data) });
  } catch (error) {
    return handleRouteError(error, "PUT /api/me/writing-style");
  }
}
