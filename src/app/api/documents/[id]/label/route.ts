import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { LabelError, labelDocument } from "@/lib/documents/label-service";

export const maxDuration = 60;

interface Params {
  params: Promise<{ id: string }>;
}

/** Writes AI filing labels for one indexed document. Asked for by the person. */
export async function POST(_request: Request, { params }: Params) {
  try {
    const access = await requireWorkspace();
    const { id } = await params;
    const document = await labelDocument(access, id);
    return NextResponse.json({ document });
  } catch (error) {
    if (error instanceof LabelError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return handleRouteError(error, "POST /api/documents/[id]/label");
  }
}
