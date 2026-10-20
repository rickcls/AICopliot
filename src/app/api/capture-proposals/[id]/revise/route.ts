import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { reviseProposalSchema } from "@/lib/capture/schemas";
import { CaptureError, reviseProposal } from "@/lib/capture/service";
import { toCaptureView } from "@/lib/capture/view";

export const maxDuration = 60;

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Redoes one pending suggestion from the person's correction. The correction
 * is added to the note; the replacements are proposals like any other.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const access = await requireWorkspace();
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = reviseProposalSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }
    const capture = await reviseProposal(access, id, parsed.data.instruction);
    if (!capture) return NextResponse.json({ error: "Capture not found" }, { status: 404 });
    return NextResponse.json({ capture: toCaptureView(capture) });
  } catch (error) {
    if (error instanceof CaptureError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return handleRouteError(error, "POST /api/capture-proposals/[id]/revise");
  }
}
