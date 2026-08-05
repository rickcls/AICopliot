import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { getStatusReport } from "@/lib/reports/service";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    const report = await getStatusReport(workspaceId, id);
    if (!report) {
      return NextResponse.json({ error: "Status report not found" }, { status: 404 });
    }
    return NextResponse.json({ report });
  } catch (error) {
    return handleRouteError(error, "GET /api/status-reports/[id]");
  }
}
