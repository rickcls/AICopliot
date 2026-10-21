import { mailDocument } from "@/lib/mail/document";

/**
 * What a capture is saved as when it becomes a document: a note by its day,
 * an email the way every kept email is (`mailDocument`) — by its subject,
 * with its sender and date above the message. Pure, so the name a person
 * will see in their documents is tested directly.
 */

export interface CaptureForDocument {
  body: string;
  source: string;
  localDate: Date;
}

/** The From/Subject/Date block `mailCaptureBody` writes above an email's text. */
function readMailHeaders(body: string) {
  const headers = new Map<string, string>();
  const lines = body.split("\n");
  let index = 0;
  for (; index < lines.length; index += 1) {
    const match = lines[index].match(/^(From|Subject|Date):\s?(.*)$/);
    if (!match) break;
    headers.set(match[1], match[2].trim());
  }
  return {
    from: headers.get("From") ?? "",
    subject: headers.get("Subject") ?? "",
    date: headers.get("Date") ?? "",
    text: lines.slice(index).join("\n"),
  };
}

export function captureDocument(capture: CaptureForDocument): { filename: string; markdown: string } {
  const day = capture.localDate.toISOString().slice(0, 10);
  if (capture.source === "email") return mailDocument(readMailHeaders(capture.body), day);
  return { filename: `note-${day}.md`, markdown: `# ${day}\n\n${capture.body}\n` };
}
