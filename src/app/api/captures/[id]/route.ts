import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { deleteCapture, getCapture } from "@/lib/capture/service";
import { toCaptureView } from "@/lib/capture/view";

interface Params {
  params: Promise<{ id: string }>;
}

/** The caller's own capture only — a colleague's id matches nothing. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const access = await requireWorkspace();
    const { id } = await params;
    const capture = await getCapture(access, id);
    if (!capture) return NextResponse.json({ error: "Capture not found" }, { status: 404 });
    return NextResponse.json({ capture: toCaptureView(capture) });
  } catch (error) {
    return handleRouteError(error, "GET /api/captures/[id]");
  }
}

/**
 * Deletes the note and its suggestions. Tasks and notes already applied from
 * it stay: once applied they are ordinary records the person chose to keep.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const access = await requireWorkspace();
    const { id } = await params;
    if (!(await deleteCapture(access, id))) {
      return NextResponse.json({ error: "Capture not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "DELETE /api/captures/[id]");
  }
}
