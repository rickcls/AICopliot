import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { deleteConversation, renameConversation } from "@/lib/chat/history";
import { renameConversationSchema } from "@/lib/schemas";

interface Params {
  params: Promise<{ id: string }>;
}

/** A thread belongs to the person who had it, so both writes scope by user. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { workspaceId, user } = await requireWorkspace();
    const { id } = await params;

    const body = await request.json().catch(() => null);
    const parsed = renameConversationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const renamed = await renameConversation(
      workspaceId,
      user.id,
      id,
      parsed.data.title,
    );
    if (!renamed) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }
    return NextResponse.json({ id, title: parsed.data.title });
  } catch (error) {
    return handleRouteError(error, "PATCH /api/chat/conversations/[id]");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { workspaceId, user } = await requireWorkspace();
    const { id } = await params;

    const deleted = await deleteConversation(workspaceId, user.id, id);
    if (!deleted) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "DELETE /api/chat/conversations/[id]");
  }
}
