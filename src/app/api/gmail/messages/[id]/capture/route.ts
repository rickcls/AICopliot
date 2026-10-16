import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { CaptureError } from "@/lib/capture/service";
import { toCaptureView } from "@/lib/capture/view";
import { captureEmail, GmailError } from "@/lib/gmail/service";

export const maxDuration = 60;

interface Params {
  params: Promise<{ id: string }>;
}

/** Reads one chosen email in full and turns it into a private capture. */
export async function POST(_request: Request, { params }: Params) {
  try {
    const access = await requireWorkspace();
    const { id } = await params;
    const capture = await captureEmail(access, id);
    if (!capture) return NextResponse.json({ error: "Capture not found" }, { status: 404 });
    return NextResponse.json({ capture: toCaptureView(capture) }, { status: 201 });
  } catch (error) {
    if (error instanceof GmailError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof CaptureError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return handleRouteError(error, "POST /api/gmail/messages/[id]/capture");
  }
}
