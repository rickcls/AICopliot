import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { deleteThread, getThread } from "@/lib/assistant/service";
import { requireWorkspace } from "@/lib/auth-guard";

interface Params {
  params: Promise<{ id: string }>;
}

/** The caller's own conversation only; anyone else's id matches nothing. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const access = await requireWorkspace();
    const { id } = await params;
    const thread = await getThread(access, id);
    if (!thread) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    return NextResponse.json({ thread });
  } catch (error) {
    return handleRouteError(error, "GET /api/assistant/threads/[id]");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const access = await requireWorkspace();
    const { id } = await params;
    if (!(await deleteThread(access, id))) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "DELETE /api/assistant/threads/[id]");
  }
}
