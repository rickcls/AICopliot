import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { listThreads } from "@/lib/assistant/service";
import { requireWorkspace } from "@/lib/auth-guard";

export async function GET() {
  try {
    const access = await requireWorkspace();
    return NextResponse.json({ threads: await listThreads(access) });
  } catch (error) {
    return handleRouteError(error, "GET /api/assistant/threads");
  }
}
