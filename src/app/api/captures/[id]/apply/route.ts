import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { applyCaptureSchema } from "@/lib/capture/schemas";
import { applyProposals, getCapture } from "@/lib/capture/service";
import { toCaptureView } from "@/lib/capture/view";

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Applies chosen proposals, each in its own transaction so one stale or
 * refused item fails alone. Returns per-item results and the capture as it now
 * stands, so the page redraws from the server's view rather than guessing.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const access = await requireWorkspace();
    const { id } = await params;
    const capture = await getCapture(access, id);
    if (!capture) return NextResponse.json({ error: "Capture not found" }, { status: 404 });

    const body = await request.json().catch(() => null);
    const parsed = applyCaptureSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    // Only proposals that belong to this capture are applied from this route.
    const own = new Set(capture.proposals.map((proposal) => proposal.id));
    const items = parsed.data.items.filter((item) => own.has(item.proposalId));
    const results = await applyProposals(access, items);

    const updated = await getCapture(access, id);
    return NextResponse.json({
      results,
      capture: updated ? toCaptureView(updated) : null,
    });
  } catch (error) {
    return handleRouteError(error, "POST /api/captures/[id]/apply");
  }
}
