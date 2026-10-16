import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { AssistantError, runAssistantTurn } from "@/lib/assistant/service";
import { requireWorkspace } from "@/lib/auth-guard";
import { assistantQuestionSchema } from "@/lib/schemas";

export const maxDuration = 60;

/**
 * One assistant turn: a bounded tool loop inside this request. It reads,
 * saves drafts, and proposes changes; it never applies or sends anything.
 */
export async function POST(request: Request) {
  try {
    const access = await requireWorkspace();
    const body = await request.json().catch(() => null);
    const parsed = assistantQuestionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }
    return NextResponse.json(await runAssistantTurn(access, parsed.data), { status: 201 });
  } catch (error) {
    if (error instanceof AssistantError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return handleRouteError(error, "POST /api/assistant");
  }
}
