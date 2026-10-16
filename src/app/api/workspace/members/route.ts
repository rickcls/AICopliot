import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { listMembers } from "@/lib/workspace/service";

export async function GET() {
  try {
    const { workspaceId } = await requireWorkspace();
    return NextResponse.json({ members: await listMembers(workspaceId) });
  } catch (error) {
    return handleRouteError(error, "GET /api/workspace/members");
  }
}
