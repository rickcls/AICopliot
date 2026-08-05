import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireProject, requireWorkspace } from "@/lib/auth-guard";
import {
  generateStatusReport,
  listStatusReports,
  StatusReportRequestError,
} from "@/lib/reports/service";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    const project = await requireProject(workspaceId, id);
    const reports = await listStatusReports(workspaceId, project.id);
    return NextResponse.json({ reports });
  } catch (error) {
    return handleRouteError(error, "GET /api/projects/[id]/status-reports");
  }
}

export async function POST(_request: Request, { params }: Params) {
  try {
    const { workspaceId, user } = await requireWorkspace();
    const { id } = await params;
    const project = await requireProject(workspaceId, id);
    const report = await generateStatusReport({
      workspaceId,
      projectId: project.id,
      userId: user.id,
    });
    return NextResponse.json({ report }, { status: 201 });
  } catch (error) {
    if (error instanceof StatusReportRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return handleRouteError(error, "POST /api/projects/[id]/status-reports");
  }
}
