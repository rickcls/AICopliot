/**
 * Reading a Gmail API message into plain text for a capture. Pure.
 *
 * Gmail returns a MIME tree with base64url bodies. Plain text is preferred;
 * HTML is reduced to text when it is all there is. The quoted thread below a
 * reply is cut off, because the capture is about this message, and the older
 * messages would otherwise be proposed as tasks all over again.
 */

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

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Lines that start the quoted history below a reply. */
const QUOTE_MARKERS = [
  /^On .{4,200} wrote:\s*$/m,
  /^-{2,}\s*Original Message\s*-{2,}\s*$/im,
  /^-{2,}\s*Forwarded message\s*-{2,}\s*$/im,
  /^From: .+\n(?:Sent|Date): .+$/m,
  /^寄件者[：:].+$/m,
  /^於 .{4,200} 寫道[：:]\s*$/m,
  /^在 .{4,200} 寫道[：:]\s*$/m,
];

export function stripQuotedReply(text: string): string {
  let cut = text.length;
  for (const marker of QUOTE_MARKERS) {
    const match = marker.exec(text);
    if (match && match.index > 0 && match.index < cut) cut = match.index;
  }
  return text
    .slice(0, cut)
    .split("\n")
    .filter((line) => !line.startsWith(">"))
    .join("\n")
    .trim();
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
export function emailCaptureBody(
  payload: GmailPart,
  maxChars = 8000,
): string {
  const lines = [
    `From: ${header(payload, "From") ?? ""}`,
    `Subject: ${header(payload, "Subject") ?? ""}`,
    `Date: ${header(payload, "Date") ?? ""}`,
    "",
    extractEmailText(payload),
  ];
  return lines.join("\n").slice(0, maxChars);
}
