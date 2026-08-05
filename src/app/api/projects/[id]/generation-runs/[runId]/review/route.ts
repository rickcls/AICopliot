import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireProject, requireWorkspace } from "@/lib/auth-guard";
import {
  editDraftProposal,
  reviewDraftProposals,
} from "@/lib/generation/review";
import { reviewGenerationRunSchema } from "@/lib/generation/schemas";
import { GenerationRequestError } from "@/lib/generation/service";

interface Params {
  params: Promise<{ id: string; runId: string }>;
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { workspaceId, userId } = await requireWorkspace();
    const { id, runId } = await params;
    const project = await requireProject(workspaceId, id);
    const body = await request.json().catch(() => null);
    const parsed = reviewGenerationRunSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid review action" },
        { status: 400 },
      );
    }

    const context = {
      workspaceId,
      projectId: project.id,
      runId,
      userId,
    };
    if (parsed.data.action === "edit") {
      const proposal = await editDraftProposal(
        context,
        parsed.data.item,
        parsed.data.changes,
      );
      return NextResponse.json({ proposal });
    }

    const run = await reviewDraftProposals(
      context,
      parsed.data.action,
      parsed.data.items,
    );
    return NextResponse.json({ run });
  } catch (error) {
    if (error instanceof GenerationRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return handleRouteError(
      error,
      "POST /api/projects/[id]/generation-runs/[runId]/review",
    );
  }
}
