import { SUPPORTED_EXTENSIONS } from "@/lib/ingest/validate-upload";
import type { MailForCapture } from "@/lib/mail/text";

/**
 * An email kept as a document — attached to a task, filed in a project, or
 * read for requirements. Every uploader takes `.eml` and `.msg`, but the
 * server never sees one: the browser reads the message and uploads it as a
 * Markdown document named by its subject, so the upload route, its three-way
 * check, and indexing stay exactly as they are. Attachments inside the email
 * are not kept; the person uploads those as files of their own.
 */

export const MAIL_FILE = /\.(eml|msg)$/i;
/** Attachments make mail files large; only the message text is wanted. */
export const MAX_MAIL_FILE_BYTES = 25 * 1024 * 1024;

/** What a file picker or drop zone offers: every indexed type, and email. */
export const UPLOAD_EXTENSIONS = [...SUPPORTED_EXTENSIONS, ".eml", ".msg"];

const MAX_TITLE_CHARS = 80;

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

/** The document for one email: named by its subject, sender and date above the message. */
export function mailDocument(mail: MailForCapture, day: string): { filename: string; markdown: string } {
  const title = fileTitle(mail.subject) || `email-${day}`;
  const meta = [mail.from ? `- From: ${mail.from}` : null, mail.date ? `- Date: ${mail.date}` : null].filter(
    (line): line is string => line !== null,
  );
  return {
    filename: `${title}.md`,
    markdown: [`# ${mail.subject.trim() || title}`, "", ...meta, ...(meta.length ? [""] : []), mail.text.trim(), ""].join(
      "\n",
    ),
  };
}

export class MailFileError extends Error {
  constructor(readonly code: "too_large" | "empty") {
    super(code);
    this.name = "MailFileError";
  }
}

/** The message for an email that could not be read, or null for any other failure. */
export function mailFileErrorKey(error: unknown) {
  if (!(error instanceof MailFileError)) return null;
  return error.code === "too_large" ? ("capture.mailFileTooLarge" as const) : ("capture.mailFileEmpty" as const);
}

/** The person's local calendar day, for an email with no subject to be named by. */
function localDay(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The file an uploader should send: an email becomes its Markdown document,
 * anything else goes as it is. The mail parsers load only when an email is
 * actually chosen, so pages with an uploader do not carry them.
 */
export async function asUploadable(file: File, now: Date = new Date()): Promise<File> {
  if (!MAIL_FILE.test(file.name)) return file;
  if (file.size > MAX_MAIL_FILE_BYTES) throw new MailFileError("too_large");
  const { readMailFile } = await import("@/lib/mail/file");
  // The whole message, quoted thread included: unlike a capture, which wants
  // only what is new, a kept email is read later for its context.
  const mail = await readMailFile(file.name, await file.arrayBuffer(), { keepQuoted: true });
  if (!mail) throw new MailFileError("empty");
  const { filename, markdown } = mailDocument(mail, localDay(now));
  return new File([markdown], filename, { type: "text/markdown" });
}
