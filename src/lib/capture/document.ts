/**
 * What a capture is saved as when it becomes a document: a note by its day,
 * an email by its subject with its sender and date kept above the message.
 * Pure, so the name a person will see in their documents is tested directly.
 */

export interface CaptureForDocument {
  body: string;
  source: string;
  localDate: Date;
}

const MAX_TITLE_CHARS = 80;

/** The From/Subject/Date block `mailCaptureBody` writes above an email's text. */
function readMailHeaders(body: string): { headers: Map<string, string>; text: string } {
  const headers = new Map<string, string>();
  const lines = body.split("\n");
  let index = 0;
  for (; index < lines.length; index += 1) {
    const match = lines[index].match(/^(From|Subject|Date):\s?(.*)$/);
    if (!match) break;
    headers.set(match[1], match[2].trim());
  }
  return { headers, text: lines.slice(index).join("\n").trim() };
}

/**
 * A subject made tidy as a file name, which is all it is used for — storage
 * keys come from ids, and `storeDocument` strips control characters itself.
 */
function fileTitle(subject: string): string {
  const cleaned = subject
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [...cleaned].slice(0, MAX_TITLE_CHARS).join("").trim();
}

export function captureDocument(capture: CaptureForDocument): { filename: string; markdown: string } {
  const day = capture.localDate.toISOString().slice(0, 10);
  if (capture.source === "email") {
    const { headers, text } = readMailHeaders(capture.body);
    const subject = headers.get("Subject") ?? "";
    const title = fileTitle(subject) || `email-${day}`;
    const meta = [
      headers.get("From") ? `- From: ${headers.get("From")}` : null,
      headers.get("Date") ? `- Date: ${headers.get("Date")}` : null,
    ].filter((line): line is string => line !== null);
    return {
      filename: `${title}.md`,
      markdown: [`# ${subject || title}`, "", ...meta, ...(meta.length ? [""] : []), text, ""].join("\n"),
    };
  }
  return { filename: `note-${day}.md`, markdown: `# ${day}\n\n${capture.body}\n` };
}
