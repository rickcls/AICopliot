/**
 * Mail as text for a capture, whichever mailbox it came from — Gmail, Outlook,
 * or a mail file dropped in the browser. Pure, so the browser can use it too.
 *
 * Plain text is preferred; HTML is reduced to text when it is all there is.
 * The quoted thread below a reply is cut off, because the capture is about this
 * message, and the older ones would otherwise be proposed as tasks again.
 */

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

export interface MailForCapture {
  from: string;
  subject: string;
  date: string;
  text: string;
}

/** The capture body for one email: who, what, when, then the message. */
export function mailCaptureBody(mail: MailForCapture, maxChars = 8000): string {
  return [`From: ${mail.from}`, `Subject: ${mail.subject}`, `Date: ${mail.date}`, "", mail.text]
    .join("\n")
    .slice(0, maxChars);
}
