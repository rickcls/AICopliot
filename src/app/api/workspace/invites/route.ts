import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { createInviteSchema } from "@/lib/schemas";
import { createInvite, listPendingInvites } from "@/lib/workspace/service";

/**
 * Creates a single-use invite link (admins only). The response is the only
 * place the link ever appears: the database keeps a hash of its token.
 */
export async function POST(request: Request) {
  try {
    const access = await requireWorkspace();
    const body = await request.json().catch(() => ({}));
    const parsed = createInviteSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const { invite, token } = await createInvite(access, parsed.data.role ?? "member");
    const url = new URL(`/invite/${token}`, request.url).toString();
    return NextResponse.json({ invite, url }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "POST /api/workspace/invites");
  }
}

export async function GET() {
  try {
    const access = await requireWorkspace();
    return NextResponse.json({ invites: await listPendingInvites(access) });
  } catch (error) {
    return handleRouteError(error, "GET /api/workspace/invites");
  }
}
