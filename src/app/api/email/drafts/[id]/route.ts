import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { deleteEmailDraft } from "@/lib/email/service";

interface Params {
  params: Promise<{ id: string }>;
}

/** Deletes one of the caller's own drafts; anyone else's id matches nothing. */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const access = await requireWorkspace();
    const { id } = await params;
    if (!(await deleteEmailDraft(access, id))) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "DELETE /api/email/drafts/[id]");
  }
}
