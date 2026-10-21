import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { listRecentOutlookMail, OutlookError } from "@/lib/outlook/service";

/** Recent inbox headers, read when the person presses "Check Outlook". */
export async function GET() {
  try {
    const access = await requireWorkspace();
    return NextResponse.json({ messages: await listRecentOutlookMail(access) });
  } catch (error) {
    if (error instanceof OutlookError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return handleRouteError(error, "GET /api/outlook/messages");
  }
}
