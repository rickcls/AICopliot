import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { notifyRegistration } from "@/lib/auth/welcome-email";
import { prisma } from "@/lib/db";
import { getLocale } from "@/lib/i18n/server";
import { publicOrigin, resolveMailSender } from "@/lib/outbound/send";
import { registerSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "An account with that email already exists" },
      { status: 409 },
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // The workspace is created lazily on first authenticated request
  // (getOrCreateDefaultWorkspace), so registration only creates the identity.
  await prisma.user.create({ data: { name, email, passwordHash } });

  await notifyRegistration({
    to: email,
    name,
    locale: await getLocale(),
    signInUrl: `${publicOrigin(request.url)}/login`,
    sender: resolveMailSender(),
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
