import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireUser } from "@/lib/auth-guard";
import { acceptInviteSchema } from "@/lib/schemas";
import { acceptInvite, InviteError } from "@/lib/workspace/service";

/**
 * Joins the signed-in person to the workspace an invite link names. Only a
 * signed-in user is required — they are not a member yet, so there is no
 * workspace to require; the token is what authorises them.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json().catch(() => null);
    const parsed = acceptInviteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "This invite link is not valid", code: "not_found" },
        { status: 404 },
      );
    }

    const result = await acceptInvite(user.id, parsed.data.token);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof InviteError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return handleRouteError(error, "POST /api/invites/accept");
  }
}
