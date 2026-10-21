/**
 * Reading a Gmail API message into plain text for a capture. Pure.
 *
 * Gmail returns a MIME tree with base64url bodies. Plain text is preferred;
 * HTML is reduced to text when it is all there is. The quoted thread below a
 * reply is cut off, because the capture is about this message, and the older
 * messages would otherwise be proposed as tasks all over again.
 */

import { htmlToText, mailCaptureBody, stripQuotedReply } from "@/lib/mail/text";

export { htmlToText, stripQuotedReply } from "@/lib/mail/text";

export interface GmailPart {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
  headers?: { name: string; value: string }[];
}

export function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

export function header(part: GmailPart | undefined, name: string): string | null {
  const found = part?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase());
  return found?.value ?? null;
}

function findPart(part: GmailPart, mimeType: string): GmailPart | null {
  if (part.mimeType === mimeType && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return null;
}

export function extractEmailText(payload: GmailPart): string {
  const plain = findPart(payload, "text/plain");
  if (plain?.body?.data) return stripQuotedReply(decodeBase64Url(plain.body.data));
  const html = findPart(payload, "text/html");
  if (html?.body?.data) return stripQuotedReply(htmlToText(decodeBase64Url(html.body.data)));
  if (payload.body?.data) return stripQuotedReply(decodeBase64Url(payload.body.data));
  return "";
}

/** The capture body for one email: who, what, when, then the message. */
export function emailCaptureBody(payload: GmailPart, maxChars = 8000): string {
  return mailCaptureBody(
    {
      from: header(payload, "From") ?? "",
      subject: header(payload, "Subject") ?? "",
      date: header(payload, "Date") ?? "",
      text: extractEmailText(payload),
    },
    maxChars,
  );
}
