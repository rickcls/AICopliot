import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { applyAssistantProposals, getMessageView } from "@/lib/assistant/service";
import { requireWorkspace } from "@/lib/auth-guard";
import { applyCaptureSchema } from "@/lib/capture/schemas";

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Applies what the assistant proposed, each item in its own transaction
 * through the shared write path, and returns the message as it now stands.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const access = await requireWorkspace();
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = applyCaptureSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }
    const results = await applyAssistantProposals(access, id, parsed.data.items);
    return NextResponse.json({ results, message: await getMessageView(access, id) });
  } catch (error) {
    return handleRouteError(error, "POST /api/assistant/messages/[id]/apply");
  }
}
