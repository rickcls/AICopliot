import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { GmailError, listRecentMail } from "@/lib/gmail/service";

/** Recent inbox headers, read when the person presses "Check Gmail". */
export async function GET() {
  try {
    const access = await requireWorkspace();
    return NextResponse.json({ messages: await listRecentMail(access) });
  } catch (error) {
    if (error instanceof GmailError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return handleRouteError(error, "GET /api/gmail/messages");
  }
}
