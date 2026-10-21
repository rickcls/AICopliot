import { describe, expect, it } from "vitest";
import {
  MAX_MAIL_FILE_BYTES,
  MailFileError,
  UPLOAD_EXTENSIONS,
  asUploadable,
  mailDocument,
  mailFileErrorKey,
} from "@/lib/mail/document";

/**
 * An email kept as a document from any uploader: read in the browser and sent
 * as Markdown, so the server's own upload checks never have to know email.
 */

const NOW = new Date(2026, 9, 21, 15, 0); // the person's local 21 October

const eml = (subject: string, body: string) =>
  [
    "From: Mary Wong <mary@harbourfit.hk>",
    `Subject: ${subject}`,
    "Date: Wed, 21 Oct 2026 10:05:00 +0800",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ].join("\r\n");

describe("mailDocument", () => {
  it("names the document by the subject and keeps sender and date above the message", () => {
    expect(
      mailDocument({ from: "Mary <m@x.hk>", subject: "報價：裝修", date: "2026-10-21", text: "請報價。\n" }, "2026-10-21"),
    ).toEqual({
      filename: "報價：裝修.md",
      markdown: "# 報價：裝修\n\n- From: Mary <m@x.hk>\n- Date: 2026-10-21\n\n請報價。\n",
    });
  });

  it("names an email with no subject by the day", () => {
    expect(mailDocument({ from: "", subject: " ", date: "", text: "Hi" }, "2026-10-21").filename).toBe(
      "email-2026-10-21.md",
    );
  });
});

describe("asUploadable", () => {
  it("is offered by every uploader alongside the indexed types", () => {
    expect(UPLOAD_EXTENSIONS).toEqual(expect.arrayContaining([".pdf", ".docx", ".md", ".eml", ".msg"]));
  });

  it("sends any other file exactly as chosen", async () => {
    const pdf = new File(["%PDF-1.7"], "brief.pdf", { type: "application/pdf" });
    expect(await asUploadable(pdf, NOW)).toBe(pdf);
  });

  it("turns an .eml into a Markdown document, quoted thread kept", async () => {
    const file = new File(
      [eml("Site visit", "Please arrange the site visit by 10 Nov.\r\n\r\nOn Mon, Rick wrote:\r\n> Sure")],
      "visit.eml",
      { type: "message/rfc822" },
    );

    const sent = await asUploadable(file, NOW);

    expect(sent.name).toBe("Site visit.md");
    expect(sent.type).toBe("text/markdown");
    const text = await sent.text();
    expect(text.startsWith("# Site visit\n\n- From: Mary Wong <mary@harbourfit.hk>\n")).toBe(true);
    expect(text).toContain("Please arrange the site visit by 10 Nov.");
    // A kept email is read later for its context; a capture is what cuts this.
    expect(text).toContain("> Sure");
  });

  it("refuses an email too large to be only text, or one with no message", async () => {
    const huge = new File([new Uint8Array(MAX_MAIL_FILE_BYTES + 1)], "big.eml");
    const error = await asUploadable(huge, NOW).catch((caught) => caught);
    expect(error).toBeInstanceOf(MailFileError);
    expect(mailFileErrorKey(error)).toBe("capture.mailFileTooLarge");

    const empty = new File([eml("Nothing", "")], "empty.eml");
    expect(mailFileErrorKey(await asUploadable(empty, NOW).catch((caught) => caught))).toBe("capture.mailFileEmpty");
    expect(mailFileErrorKey(new Error("network"))).toBeNull();
  });
});
