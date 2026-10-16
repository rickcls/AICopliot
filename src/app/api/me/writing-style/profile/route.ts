import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireUser } from "@/lib/auth-guard";
import { deriveStyleProfile, EmailError } from "@/lib/email/service";

export const maxDuration = 60;

/** Describes the caller's tone from their samples. One model call. */
export async function POST() {
  try {
    const user = await requireUser();
    return NextResponse.json({ style: await deriveStyleProfile(user.id) });
  } catch (error) {
    if (error instanceof EmailError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return handleRouteError(error, "POST /api/me/writing-style/profile");
  }
}
