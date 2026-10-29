import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { createInviteSchema } from "@/lib/schemas";
import {
  createInvite,
  createWorkspaceInvite,
  listPendingInvites,
  WorkspaceNameTakenError,
} from "@/lib/workspace/service";

/**
 * Creates a single-use invite link. The response is the only place the link
 * ever appears: the database keeps a hash of its token.
 *
 * The default joins the current workspace and is admins only. `destination:
 * "new"` creates a workspace the caller owns and invites into that one
 * instead — it does not switch them into it.
 */
export async function POST(request: Request) {
  try {
    const access = await requireWorkspace();
    const body = await request.json().catch(() => ({}));
    const parsed = createInviteSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid invite" }, { status: 400 });
    }

    const role = parsed.data.role ?? "member";
    if (parsed.data.destination === "new" && parsed.data.name) {
      try {
        const { invite, token, workspace } = await createWorkspaceInvite(
          access.userId,
          parsed.data.name,
          role,
        );
        const url = new URL(`/invite/${token}`, request.url).toString();
        return NextResponse.json({ invite, url, workspace }, { status: 201 });
      } catch (error) {
        if (error instanceof WorkspaceNameTakenError) {
          return NextResponse.json(
            { error: error.message, code: "name_taken" },
            { status: 409 },
          );
        }
        throw error;
      }
    }

    const { invite, token } = await createInvite(access, role);
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
