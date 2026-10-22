import { NextResponse } from "next/server";
import { requestPasswordReset } from "@/lib/auth/password-reset-service";
import { currentMailDelivery, publicOrigin, resolveMailSender } from "@/lib/outbound/send";
import { forgotPasswordSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  // Checked before the address is looked up, so a missing sender is the same
  // answer for every request.
  const delivery = currentMailDelivery();
  const sender = resolveMailSender();
  if (delivery === "unavailable" || !sender) {
    return NextResponse.json(
      { error: "Password reset email is not configured" },
      { status: 503 },
    );
  }

  await requestPasswordReset({
    email: parsed.data.email,
    origin: publicOrigin(request.url),
    sender,
  });

  return NextResponse.json({ ok: true, delivery });
}
