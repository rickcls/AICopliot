/**
 * The one way mail leaves the product.
 *
 * Password reset and the registration notice use it. A later alert must call
 * `sendTransactionalEmail` too. Drafts on `/email` and the assistant do not.
 *
 * Resend is an HTTP call, which a serverless function can make. SMTP from
 * the same function is not. Without `RESEND_API_KEY` and `EMAIL_FROM`,
 * production refuses; development logs the message so a reset can be tried
 * on this machine.
 */

export type TransactionalEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type MailSettings = {
  apiKey: string;
  from: string;
};

export type MailSender = (message: TransactionalEmail) => Promise<void>;

export class OutboundMailError extends Error {
  constructor(readonly code: "not_configured" | "rejected") {
    super(code);
    this.name = "OutboundMailError";
  }
}

/** Both values are required. A key with no from-address is not configured. */
export function mailSettingsFrom(env: {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}): MailSettings | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (!apiKey || !from) return null;
  return { apiKey, from };
}

/**
 * `log` is development without a key: the message is printed, not sent, so
 * the screen must not say it is on its way. Production without a key is
 * `unavailable` and the request stops before any address is looked up.
 */
export function mailDelivery(
  settings: MailSettings | null,
  nodeEnv: string | undefined,
): "resend" | "log" | "unavailable" {
  if (settings) return "resend";
  if (nodeEnv !== "production") return "log";
  return "unavailable";
}

const RESEND_URL = "https://api.resend.com/emails";

export async function sendWithResend(
  message: TransactionalEmail,
  settings: MailSettings,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: settings.from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) throw new OutboundMailError("rejected");
}
