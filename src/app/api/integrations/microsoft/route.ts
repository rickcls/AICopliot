import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireUser } from "@/lib/auth-guard";
import { disconnectOutlook, getOutlookStatus } from "@/lib/outlook/service";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ outlook: await getOutlookStatus(user.id) });
  } catch (error) {
    return handleRouteError(error, "GET /api/integrations/microsoft");
  }
}

/** Disconnects: the stored token is deleted, so nothing can be read any more. */
export async function DELETE() {
  try {
    const user = await requireUser();
    await disconnectOutlook(user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "DELETE /api/integrations/microsoft");
  }
}
