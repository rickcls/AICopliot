import MsgReader from "@kenjiuno/msgreader";
import PostalMime from "postal-mime";
import { htmlToText, mailCaptureBody, stripQuotedReply, type MailForCapture } from "@/lib/mail/text";

/**
 * An email file dropped into the capture box — the way in when a company's IT
 * has not approved the Outlook connection. Outlook on the web downloads `.eml`;
 * Outlook for Windows drags out `.msg`. Read in the browser and never uploaded:
 * only the text the capture needs is sent.
 */

export const MAIL_FILE = /\.(eml|msg)$/i;
/** Attachments make mail files large; only the message text is wanted. */
export const MAX_MAIL_FILE_BYTES = 25 * 1024 * 1024;

function message(fields: Omit<MailForCapture, "text"> & { text?: string; html?: string }): MailForCapture | null {
  const text = fields.text?.trim() ? fields.text : fields.html ? htmlToText(fields.html) : "";
  const body = stripQuotedReply(text);
  return body ? { from: fields.from, subject: fields.subject, date: fields.date, text: body } : null;
}

/** An `.eml`. Its declared charset is honoured, Big5 included. */
export async function emlToMail(data: ArrayBuffer | string): Promise<MailForCapture | null> {
  const email = await PostalMime.parse(data);
  const sender = email.from && "address" in email.from ? email.from : null;
  const from =
    sender?.name && sender.address ? `${sender.name} <${sender.address}>` : (sender?.name ?? sender?.address ?? "");
  return message({ from, subject: email.subject ?? "", date: email.date ?? "", text: email.text, html: email.html });
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

export function msgFieldsToMail(fields: MsgFields): MailForCapture | null {
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
  });
}

/** A dropped mail file as capture text, or null if it holds no message text. */
export async function mailFileToCaptureText(name: string, data: ArrayBuffer): Promise<string | null> {
  const mail = /\.msg$/i.test(name)
    ? msgFieldsToMail(new MsgReader(data).getFileData())
    : await emlToMail(data);
  return mail ? mailCaptureBody(mail) : null;
}
