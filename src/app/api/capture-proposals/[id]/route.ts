import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { decideProposalSchema } from "@/lib/capture/schemas";
import { decideProposal } from "@/lib/capture/service";

interface Params {
  params: Promise<{ id: string }>;
}

/** Dismisses a suggestion, or brings a dismissed one back. Applied ones are final. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const access = await requireWorkspace();
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = decideProposalSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid state" }, { status: 400 });
    }
    if (!(await decideProposal(access, id, parsed.data.state))) {
      return NextResponse.json(
        { error: "Suggestion not found, or already applied" },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "PATCH /api/capture-proposals/[id]");
  }
}
