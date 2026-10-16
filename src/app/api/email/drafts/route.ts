import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { draftEmail, EmailError, listEmailDrafts } from "@/lib/email/service";
import { emailDraftRequestSchema } from "@/lib/schemas";

export const maxDuration = 60;

/** Drafts an email in the caller's voice. Nothing is sent, ever. */
export async function POST(request: Request) {
  try {
    const access = await requireWorkspace();
    const body = await request.json().catch(() => null);
    const parsed = emailDraftRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }
    return NextResponse.json({ draft: await draftEmail(access, parsed.data) }, { status: 201 });
  } catch (error) {
    if (error instanceof EmailError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return handleRouteError(error, "POST /api/email/drafts");
  }
}

export async function GET() {
  try {
    const access = await requireWorkspace();
    return NextResponse.json({ drafts: await listEmailDrafts(access) });
  } catch (error) {
    return handleRouteError(error, "GET /api/email/drafts");
  }
}
