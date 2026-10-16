import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { revokeInvite } from "@/lib/workspace/service";

interface Params {
  params: Promise<{ id: string }>;
}

/** Withdraws an unused link. An id from another workspace matches nothing. */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const access = await requireWorkspace();
    const { id } = await params;
    if (!(await revokeInvite(access, id))) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "DELETE /api/workspace/invites/[id]");
  }
}
