import { createHash, randomBytes } from "node:crypto";
import { translatorFor } from "@/lib/i18n/dictionaries";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n/locales";
import type { TransactionalEmail } from "@/lib/outbound/mail";

/**
 * A reset link is a bearer token. The token is 32 random bytes, it exists
 * only in the email, and only its SHA-256 is stored.
 */

export const RESET_TTL_MS = 60 * 60 * 1000;
export const RESET_COOLDOWN_MS = 60 * 1000;

export function generateResetToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function resetExpiry(now: Date): Date {
  return new Date(now.getTime() + RESET_TTL_MS);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** The message follows the account's saved language. */
export function passwordResetEmail(input: {
  to: string;
  resetUrl: string;
  locale: string;
  appName: string;
}): TransactionalEmail {
  const locale = isLocale(input.locale) ? input.locale : DEFAULT_LOCALE;
  const t = translatorFor(locale);
  const lead = t("auth.resetEmailLead");
  const expiry = t("auth.resetEmailExpiry");
  const ignore = t("auth.resetEmailIgnore");
  const url = escapeHtml(input.resetUrl);

  return {
    to: input.to,
    subject: t("auth.resetEmailSubject", { app: input.appName }),
    text: `${lead}\n\n${input.resetUrl}\n\n${expiry}\n\n${ignore}`,
    html: `<p>${escapeHtml(lead)}</p><p><a href="${url}">${url}</a></p><p>${escapeHtml(expiry)}</p><p>${escapeHtml(ignore)}</p>`,
  };
}
