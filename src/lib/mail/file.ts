import MsgReader from "@kenjiuno/msgreader";
import PostalMime from "postal-mime";
import { htmlToText, mailCaptureBody, stripQuotedReply, type MailForCapture } from "@/lib/mail/text";
import { MAIL_FILE, MAX_MAIL_FILE_BYTES } from "@/lib/mail/document";

/**
 * An email file — dropped into the capture box (the way in when a company's IT
 * has not approved the Outlook connection), or chosen in an uploader to be
 * kept as a document (`asUploadable` in `mail/document.ts`). Outlook on the
 * web downloads `.eml`; Outlook for Windows drags out `.msg`. Read in the
 * browser and never uploaded: only the text is sent.
 */

export { MAIL_FILE, MAX_MAIL_FILE_BYTES };

/** `keepQuoted` keeps the thread below the reply — wanted when the email is kept as a document. */
export interface ReadMailOptions {
  keepQuoted?: boolean;
}

function message(
  fields: Omit<MailForCapture, "text"> & { text?: string; html?: string },
  { keepQuoted = false }: ReadMailOptions = {},
): MailForCapture | null {
  const text = fields.text?.trim() ? fields.text : fields.html ? htmlToText(fields.html) : "";
  const body = keepQuoted ? text.trim() : stripQuotedReply(text);
  return body ? { from: fields.from, subject: fields.subject, date: fields.date, text: body } : null;
}

/** An `.eml`. Its declared charset is honoured, Big5 included. */
export async function emlToMail(
  data: ArrayBuffer | string,
  options: ReadMailOptions = {},
): Promise<MailForCapture | null> {
  const email = await PostalMime.parse(data);
  const sender = email.from && "address" in email.from ? email.from : null;
  const from =
    sender?.name && sender.address ? `${sender.name} <${sender.address}>` : (sender?.name ?? sender?.address ?? "");
  return message(
    { from, subject: email.subject ?? "", date: email.date ?? "", text: email.text, html: email.html },
    options,
  );
}

/** The fields an Outlook `.msg` carries, as MsgReader reads them. */
export interface MsgFields {
  subject?: string;
  senderName?: string;
  senderEmail?: string;
  body?: string;
  bodyHtml?: string;
  messageDeliveryTime?: string;
  clientSubmitTime?: string;
}

export function msgFieldsToMail(fields: MsgFields, options: ReadMailOptions = {}): MailForCapture | null {
  const from =
    fields.senderName && fields.senderEmail
      ? `${fields.senderName} <${fields.senderEmail}>`
      : (fields.senderName ?? fields.senderEmail ?? "");
  return message({
    from,
    subject: fields.subject ?? "",
    date: fields.messageDeliveryTime ?? fields.clientSubmitTime ?? "",
    text: fields.body,
    html: fields.bodyHtml,
  }, options);
}

/** A dropped mail file as capture text, or null if it holds no message text. */
export async function mailFileToCaptureText(name: string, data: ArrayBuffer): Promise<string | null> {
  const mail = await readMailFile(name, data);
  return mail ? mailCaptureBody(mail) : null;
}

/** A mail file's message, by its extension: `.msg` from Outlook for Windows, else `.eml`. */
export async function readMailFile(
  name: string,
  data: ArrayBuffer,
  options: ReadMailOptions = {},
): Promise<MailForCapture | null> {
  return /\.msg$/i.test(name)
    ? msgFieldsToMail(new MsgReader(data).getFileData(), options)
    : emlToMail(data, options);
}
