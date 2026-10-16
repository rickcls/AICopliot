import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireUser } from "@/lib/auth-guard";
import { disconnectGmail, getGmailStatus } from "@/lib/gmail/service";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ gmail: await getGmailStatus(user.id) });
  } catch (error) {
    return handleRouteError(error, "GET /api/integrations/google");
  }
}

/** Disconnects: revokes the token at Google (best effort) and deletes it here. */
export async function DELETE() {
  try {
    const user = await requireUser();
    await disconnectGmail(user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "DELETE /api/integrations/google");
  }
}
