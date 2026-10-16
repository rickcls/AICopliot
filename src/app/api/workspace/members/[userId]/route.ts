import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { updateMemberSchema } from "@/lib/schemas";
import { changeMember } from "@/lib/workspace/service";

interface Params {
  params: Promise<{ userId: string }>;
}

/** Changes a member's role. Who may do so is decided by `canChangeMember`. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const access = await requireWorkspace();
    const { userId } = await params;
    const body = await request.json().catch(() => null);
    const parsed = updateMemberSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Choose admin or member" }, { status: 400 });
    }

    await changeMember(access, userId, { kind: "role", role: parsed.data.role });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "PATCH /api/workspace/members/[userId]");
  }
}

/** Removes a member, or lets someone leave when the id is their own. */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const access = await requireWorkspace();
    const { userId } = await params;
    await changeMember(access, userId, { kind: "remove" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "DELETE /api/workspace/members/[userId]");
  }
}
