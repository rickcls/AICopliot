import { describe, expect, it } from "vitest";
import { captureDocument } from "@/lib/capture/document";

/**
 * The document a capture becomes: the name a person sees in their documents,
 * and the text kept — an email's sender and date above its message.
 */

const day = new Date("2026-10-16T00:00:00Z");

describe("captureDocument", () => {
  it("names an email by its subject and keeps who sent it and when", () => {
    const { filename, markdown } = captureDocument({
      source: "email",
      localDate: day,
      body: "From: Peter Chan <peter@abc.com>\nSubject: 報價：系統升級\nDate: 2026-10-15 09:12\n\n請於下星期五前報價。\n包括三年維護。",
    });
    expect(filename).toBe("報價：系統升級.md");
    expect(markdown).toBe(
      "# 報價：系統升級\n\n- From: Peter Chan <peter@abc.com>\n- Date: 2026-10-15 09:12\n\n請於下星期五前報價。\n包括三年維護。\n",
    );
  });

  it("takes out the characters a file name cannot hold", () => {
    expect(captureDocument({ source: "email", localDate: day, body: "Subject: Re: Q4 / budget?\n\nx" }).filename).toBe(
      "Re Q4 budget.md",
    );
  });

  it("falls back to the day for an email with no subject, and caps a long one", () => {
    expect(captureDocument({ source: "email", localDate: day, body: "From: A\nSubject: \n\nHi" }).filename).toBe(
      "email-2026-10-16.md",
    );
    const long = captureDocument({ source: "email", localDate: day, body: `Subject: ${"報".repeat(120)}\n\nx` });
    expect(long.filename).toBe(`${"報".repeat(80)}.md`);
  });

  it("keeps a typed note by its day, as before", () => {
    expect(captureDocument({ source: "text", localDate: day, body: "會議重點" })).toEqual({
      filename: "note-2026-10-16.md",
      markdown: "# 2026-10-16\n\n會議重點\n",
    });
  });
});
