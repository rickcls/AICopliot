import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { runIngestion } from "@/lib/ingest/pipeline";

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Triggers ingestion for an uploaded document.
 *
 * Today this runs synchronously inside the request. To move to S3 + SQS +
 * Lambda later, this handler enqueues a message instead and the consumer calls
 * the same runIngestion(documentId) — the function does not change, and neither
 * does the UI, which already polls for status.
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await params;

    const document = await prisma.document.findFirst({
      where: { id, workspaceId },
      select: { id: true },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    try {
      const result = await runIngestion(document.id);
      return NextResponse.json({ status: "ready", chunkCount: result.chunkCount });
    } catch (cause) {
      // runIngestion already recorded status='failed' with the reason; surface
      // it as a handled 422 rather than an opaque 500.
      return NextResponse.json(
        {
          status: "failed",
          error: (cause as Error).message ?? "Ingestion failed",
        },
        { status: 422 },
      );
    }
  } catch (error) {
    return handleRouteError(error, "POST /api/documents/[id]/process");
  }
}
