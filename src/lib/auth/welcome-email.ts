import { translatorFor } from "@/lib/i18n/dictionaries";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n/locales";
import type { MailSender, TransactionalEmail } from "@/lib/outbound/mail";

const APP_NAME = "ScopePilot";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * A notice that the account exists. It carries no password and no secret
 * link. The language is the page the person signed up on.
 */
export function welcomeEmail(input: {
  to: string;
  name: string;
  locale: string;
  signInUrl: string;
}): TransactionalEmail {
  const locale = isLocale(input.locale) ? input.locale : DEFAULT_LOCALE;
  const t = translatorFor(locale);
  const lead = t("auth.welcomeEmailLead", { name: input.name });
  const body = t("auth.welcomeEmailBody", { email: input.to });
  const ignore = t("auth.welcomeEmailIgnore");
  const url = escapeHtml(input.signInUrl);

  return {
    to: input.to,
    subject: t("auth.welcomeEmailSubject", { app: APP_NAME }),
    text: `${lead}\n\n${body}\n\n${input.signInUrl}\n\n${ignore}`,
    html: `<p>${escapeHtml(lead)}</p><p>${escapeHtml(body)}</p><p><a href="${url}">${url}</a></p><p>${escapeHtml(ignore)}</p>`,
  };
}

/**
 * Sent after the account row exists. A missing sender or a rejected message
 * leaves the account in place.
 */
export async function notifyRegistration(input: {
  to: string;
  name: string;
  locale: string;
  signInUrl: string;
  sender: MailSender | null;
}): Promise<void> {
  if (!input.sender) return;
  try {
    await input.sender(
      welcomeEmail({
        to: input.to,
        name: input.name,
        locale: input.locale,
        signInUrl: input.signInUrl,
      }),
    );
  } catch (error) {
    console.error(
      "outbound mail failed",
      error instanceof Error ? error.name : "unknown",
    );
  }
}
