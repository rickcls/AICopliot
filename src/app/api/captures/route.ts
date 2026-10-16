import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { createCaptureSchema } from "@/lib/capture/schemas";
import { CaptureError, createCapture, listCaptures } from "@/lib/capture/service";
import { toCaptureView } from "@/lib/capture/view";

export const maxDuration = 60;

/**
 * Saves what the person said and returns it with proposals. A model failure
 * still returns 201: the capture exists, marked `failed`, with its text, so
 * the page can offer Retry instead of losing what was typed.
 */
export async function POST(request: Request) {
  try {
    const access = await requireWorkspace();
    const body = await request.json().catch(() => null);
    const parsed = createCaptureSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const capture = await createCapture(access, parsed.data);
    if (!capture) return NextResponse.json({ error: "Capture not found" }, { status: 404 });
    return NextResponse.json({ capture: toCaptureView(capture) }, { status: 201 });
  } catch (error) {
    if (error instanceof CaptureError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return handleRouteError(error, "POST /api/captures");
  }
}

export async function GET(request: Request) {
  try {
    const access = await requireWorkspace();
    const params = new URL(request.url).searchParams;
    const beforeParam = params.get("before");
    const before = beforeParam ? new Date(beforeParam) : undefined;
    const captures = await listCaptures(access, {
      before: before && !Number.isNaN(before.getTime()) ? before : undefined,
      limit: Number(params.get("limit") ?? 20) || 20,
    });
    return NextResponse.json({ captures: captures.map(toCaptureView) });
  } catch (error) {
    return handleRouteError(error, "GET /api/captures");
  }
}
