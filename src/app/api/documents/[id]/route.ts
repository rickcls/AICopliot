import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;

    // findFirst with workspaceId, never findUnique by id alone: a document ID
    // from another workspace must not resolve.
    const document = await prisma.document.findFirst({
      where: { id, workspaceId },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    return NextResponse.json({ document });
  } catch (error) {
    return handleRouteError(error, "GET /api/documents/[id]");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;

    const document = await prisma.document.findFirst({
      where: { id, workspaceId },
      select: { id: true, storageKey: true },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Remove the row first; chunks cascade. Storage is cleaned up afterwards so
    // a storage hiccup cannot leave an undeletable document in the UI.
    await prisma.document.delete({ where: { id: document.id } });

    try {
      await getStorage().delete(document.storageKey);
    } catch (cause) {
      console.error("[DELETE /api/documents/[id]] orphaned file:", cause);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "DELETE /api/documents/[id]");
  }
}
