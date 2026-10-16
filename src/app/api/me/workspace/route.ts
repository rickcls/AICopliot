import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireUser, requireWorkspaceAccess } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { switchWorkspaceSchema } from "@/lib/schemas";

/**
 * Chooses the workspace the app acts in. Membership is checked first, so the
 * stored choice can only ever name a workspace the person belongs to — and it
 * is re-checked on every request anyway (`getOrCreateDefaultWorkspace`).
 */
export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json().catch(() => null);
    const parsed = switchWorkspaceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Choose a workspace" }, { status: 400 });
    }

    const access = await requireWorkspaceAccess(user.id, parsed.data.workspaceId);
    await prisma.user.update({
      where: { id: user.id },
      data: { activeWorkspaceId: access.workspaceId },
    });

    return NextResponse.json({ workspaceId: access.workspaceId });
  } catch (error) {
    return handleRouteError(error, "PUT /api/me/workspace");
  }
}
