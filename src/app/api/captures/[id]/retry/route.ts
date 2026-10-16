import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { CaptureError, retryCapture } from "@/lib/capture/service";
import { toCaptureView } from "@/lib/capture/view";

export const maxDuration = 60;

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, { params }: Params) {
  try {
    const access = await requireWorkspace();
    const { id } = await params;
    const capture = await retryCapture(access, id);
    if (!capture) return NextResponse.json({ error: "Capture not found" }, { status: 404 });
    return NextResponse.json({ capture: toCaptureView(capture) });
  } catch (error) {
    if (error instanceof CaptureError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return handleRouteError(error, "POST /api/captures/[id]/retry");
  }
}
