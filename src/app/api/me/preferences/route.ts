import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { handleRouteError } from "@/lib/api";
import { requireUser } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { LOCALE_COOKIE } from "@/lib/i18n/locales";
import { updatePreferencesSchema } from "@/lib/schemas";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Saves the signed-in person's language and time zone. Only the caller's own
 * row is written — the id comes from the session, never the body.
 *
 * The language is mirrored into a cookie so the sign-in page and landing page
 * keep it after signing out; the database row is what follows the person to
 * another device.
 */
export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json().catch(() => null);
    const parsed = updatePreferencesSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const saved = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(parsed.data.locale !== undefined ? { locale: parsed.data.locale } : {}),
        ...(parsed.data.timeZone !== undefined
          ? { timeZone: parsed.data.timeZone }
          : {}),
      },
      select: { locale: true, timeZone: true },
    });

    if (parsed.data.locale !== undefined) {
      (await cookies()).set(LOCALE_COOKIE, parsed.data.locale, {
        path: "/",
        sameSite: "lax",
        maxAge: ONE_YEAR_SECONDS,
      });
    }

    return NextResponse.json(saved);
  } catch (error) {
    return handleRouteError(error, "PATCH /api/me/preferences");
  }
}
