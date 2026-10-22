import "server-only";
import { getEnv } from "@/lib/env";
import {
  OutboundMailError,
  mailDelivery,
  mailSettingsFrom,
  sendWithResend,
  type MailSender,
  type TransactionalEmail,
} from "@/lib/outbound/mail";

export type { MailSender, TransactionalEmail };

/**
 * A real sender when Resend is configured. In development, with no key, a
 * logger so the reset link is visible in the server output. In production,
 * with no key, null — the caller says reset is unavailable and does not look
 * up the address.
 */
export function resolveMailSender(): MailSender | null {
  const delivery = currentMailDelivery();
  if (delivery === "resend") {
    const { RESEND_API_KEY, EMAIL_FROM } = getEnv();
    const settings = mailSettingsFrom({ RESEND_API_KEY, EMAIL_FROM });
    if (!settings) return null;
    return (message) => sendWithResend(message, settings);
  }
  if (delivery === "log") {
    return async (message) => {
      console.info(
        `[outbound-mail]\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`,
      );
    };
  }
  return null;
}

export function currentMailDelivery(): "resend" | "log" | "unavailable" {
  const { RESEND_API_KEY, EMAIL_FROM } = getEnv();
  return mailDelivery(mailSettingsFrom({ RESEND_API_KEY, EMAIL_FROM }), process.env.NODE_ENV);
}

/**
 * What a future alert calls. Password reset goes through here as well, via
 * `resolveMailSender`, so there is still one transport.
 */
export async function sendTransactionalEmail(message: TransactionalEmail): Promise<void> {
  const sender = resolveMailSender();
  if (!sender) throw new OutboundMailError("not_configured");
  await sender(message);
}

/** Prefer `APP_URL` so a preview host cannot decide where the link points. */
export function publicOrigin(requestUrl: string): string {
  const configured = getEnv().APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
  return new URL(requestUrl).origin;
}
