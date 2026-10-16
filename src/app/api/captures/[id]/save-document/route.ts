import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { CaptureError, saveCaptureAsDocument } from "@/lib/capture/service";
import { runIngestion } from "@/lib/ingest/pipeline";

export const maxDuration = 60;

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Saves a note as a document and indexes it in the same request — a note is
 * short, so indexing fits well inside the limit, and the person gets a
 * searchable document back rather than one still processing.
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const access = await requireWorkspace();
    const { id } = await params;
    const { documentId } = await saveCaptureAsDocument(access, id);
    await runIngestion(documentId).catch(() => undefined);
    return NextResponse.json({ documentId }, { status: 201 });
  } catch (error) {
    if (error instanceof CaptureError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return handleRouteError(error, "POST /api/captures/[id]/save-document");
  }
}
