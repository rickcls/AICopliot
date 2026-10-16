import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { documentRowSelect, toDocumentRow } from "@/lib/documents/select";
import { storeDocument } from "@/lib/documents/store";

export async function GET(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    // Narrows within the workspace only; an id from another workspace matches
    // nothing because workspaceId stays in the same where clause.
    const projectId = new URL(request.url).searchParams.get("projectId");

    const documents = await prisma.document.findMany({
      where: { workspaceId, ...(projectId ? { projectId } : {}) },
      orderBy: { createdAt: "desc" },
      select: documentRowSelect,
    });

    return NextResponse.json({ documents: documents.map(toDocumentRow) });
  } catch (error) {
    return handleRouteError(error, "GET /api/documents");
  }
}

export async function POST(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const env = getEnv();

    const formData = await request.formData();
    const file = formData.get("file");
    const rawProjectId = formData.get("projectId");
    const projectId =
      typeof rawProjectId === "string" && rawProjectId.trim()
        ? rawProjectId.trim()
        : null;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (projectId) {
      const project = await prisma.project.findFirst({
        where: { id: projectId, workspaceId },
        select: { id: true },
      });
      if (!project) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
    }

    // Reject on the declared size before buffering the whole body.
    if (file.size > env.MAX_UPLOAD_BYTES) {
      const mb = (env.MAX_UPLOAD_BYTES / 1_048_576).toFixed(1);
      return NextResponse.json(
        { error: `File exceeds the ${mb} MB limit` },
        { status: 413 },
      );
    }

    const stored = await storeDocument({
      workspaceId,
      projectId,
      filename: file.name,
      mimeType: file.type,
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    if (!stored.ok) {
      return NextResponse.json({ error: stored.error }, { status: stored.status });
    }

    return NextResponse.json({ id: stored.id, status: "uploaded" }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "POST /api/documents");
  }
}
