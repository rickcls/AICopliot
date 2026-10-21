import { describe, expect, it } from "vitest";
import { emlToMail, msgFieldsToMail } from "@/lib/mail/file";
import { mailCaptureBody } from "@/lib/mail/text";

/**
 * Email files dropped into the capture box — the way in when a company has not
 * approved the Outlook connection. Read in the browser; these pin the mapping.
 */

describe("emlToMail", () => {
  it("reads a plain-text email and cuts the quoted thread", async () => {
    const eml = [
      "From: Peter Chan <peter@abc.hk>",
      "Subject: Quote",
      "Date: Tue, 20 Oct 2026 09:15:00 +0800",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Please send the quote by Friday.",
      "",
      "On Mon, 19 Oct 2026, Rick wrote:",
      "> Will do",
    ].join("\r\n");

    const mail = await emlToMail(eml);

    expect(mail).toMatchObject({ from: "Peter Chan <peter@abc.hk>", subject: "Quote", text: "Please send the quote by Friday." });
  });

  it("decodes a Big5 email, as older Hong Kong mail often is", async () => {
    // 「請報價」 in Big5.
    const head = Buffer.from(
      "From: a@b.hk\r\nSubject: =?big5?B?s/i7+Q==?=\r\nContent-Type: text/plain; charset=big5\r\nContent-Transfer-Encoding: 8bit\r\n\r\n",
      "latin1",
    );
    const body = Buffer.from([0xbd, 0xd0, 0xb3, 0xf8, 0xbb, 0xf9]);
    const raw = Buffer.concat([head, body]);

    const mail = await emlToMail(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));

    expect(mail?.subject).toBe("報價");
    expect(mail?.text).toBe("請報價");
  });

  it("falls back to the HTML part, and has nothing to offer for an empty email", async () => {
    const html = await emlToMail("From: a@b.hk\r\nContent-Type: text/html\r\n\r\n<p>Call me</p>");
    expect(html?.text).toBe("Call me");
    expect(await emlToMail("From: a@b.hk\r\nContent-Type: text/plain\r\n\r\n")).toBeNull();
  });
});

describe("msgFieldsToMail", () => {
  it("maps an Outlook .msg's fields, preferring plain text", () => {
    const mail = msgFieldsToMail({
      subject: "Contract",
      senderName: "Mary Lee",
      senderEmail: "mary@abc.hk",
      body: "Two changes needed.",
      bodyHtml: "<p>ignored</p>",
      messageDeliveryTime: "Tue, 20 Oct 2026 03:40:10 GMT",
    });
    expect(mail && mailCaptureBody(mail)).toBe(
      "From: Mary Lee <mary@abc.hk>\nSubject: Contract\nDate: Tue, 20 Oct 2026 03:40:10 GMT\n\nTwo changes needed.",
    );
  });
});
