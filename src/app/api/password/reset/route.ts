import { NextResponse } from "next/server";
import { resetPassword } from "@/lib/auth/password-reset-service";
import { resetPasswordSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input", code: "invalid_input" },
      { status: 400 },
    );
  }

  const ok = await resetPassword(parsed.data.token, parsed.data.password);
  if (!ok) {
    return NextResponse.json(
      { error: "This reset link is not valid", code: "invalid_token" },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
