import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireProject, requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { translatorFor } from "@/lib/i18n/dictionaries";
import { getFileLocale } from "@/lib/i18n/server";
import {
  buildPack,
  exportFilename,
  packToMarkdown,
  parsePackKind,
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

    const search = new URL(request.url).searchParams;
    const format = search.get("format");
    if (format !== "csv" && format !== "md") {
      return NextResponse.json(
        { error: "format must be csv or md" },
        { status: 400 },
      );
    }
    // A pack is a client-facing Markdown document; the CSV is always the
    // whole register.
    const pack = search.has("pack") ? parsePackKind(search.get("pack")) : null;
    if (search.has("pack") && (!pack || format !== "md")) {
      return NextResponse.json(
        { error: "pack must be questions or signoff, with format=md" },
        { status: 400 },
      );
    }

    const requirements = await prisma.requirement.findMany({
      where: { workspaceId, projectId: project.id },
      orderBy: { sequence: "asc" },
      select: requirementSelect,
    });

    const t = translatorFor(await getFileLocale(search.get("lang")));
    const now = new Date();
    const body = pack
      ? packToMarkdown(pack, project.name, buildPack(pack, requirements, t), now, t)
      : format === "csv"
        ? requirementsToCsv(requirements, t)
        : requirementsToMarkdown(project.name, requirements, now, t);
    const filename = exportFilename(
      project.name,
      format,
      pack === "questions" ? "questions" : pack === "signoff" ? "sign-off" : undefined,
    );

    return new Response(body, {
      headers: {
        "Content-Type":
          format === "csv"
            ? "text/csv; charset=utf-8"
            : "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleRouteError(error, "GET /api/projects/[id]/requirements/export");
  }
}
