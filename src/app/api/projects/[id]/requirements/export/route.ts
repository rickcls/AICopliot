import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireProject, requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import {
  exportFilename,
  requirementsToCsv,
  requirementsToMarkdown,
} from "@/lib/pm/requirements-export";
import { requirementSelect } from "@/lib/pm/select";

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * The register as a file. Same rows as the register page — drafts included,
 * per invariant 14 — because the export is what gets taken back to the client
 * to confirm, and the drafts are the part that needs confirming.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;
    const project = await requireProject(workspaceId, id);

    const format = new URL(request.url).searchParams.get("format");
    if (format !== "csv" && format !== "md") {
      return NextResponse.json(
        { error: "format must be csv or md" },
        { status: 400 },
      );
    }

    const requirements = await prisma.requirement.findMany({
      where: { workspaceId, projectId: project.id },
      orderBy: { sequence: "asc" },
      select: requirementSelect,
    });

    const body =
      format === "csv"
        ? requirementsToCsv(requirements)
        : requirementsToMarkdown(project.name, requirements, new Date());

    return new Response(body, {
      headers: {
        "Content-Type":
          format === "csv"
            ? "text/csv; charset=utf-8"
            : "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFilename(project.name, format)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleRouteError(error, "GET /api/projects/[id]/requirements/export");
  }
}
