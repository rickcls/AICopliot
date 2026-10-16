import { describe, expect, it } from "vitest";
import { findUnsupportedFacts } from "@/lib/email/facts";
import { gmailComposeUrl, mailtoUrl, recipientAddress } from "@/lib/email/links";

describe("findUnsupportedFacts", () => {
  it("passes facts the person gave, however they are spaced or comma'd", () => {
    expect(
      findUnsupportedFacts("Dear Peter, the quote is HK$12,000 and is due 23/10 at 3pm.", [
        "quote HK$ 12000, due 23/10 3pm",
      ]),
    ).toEqual([]);
  });

  it("flags a date, amount, time, or weekday that came from nowhere", () => {
    const flags = findUnsupportedFacts(
      "We will deliver on 30 Nov, Friday, at 10:30 for US$500 (15% off).",
      ["Tell them we can deliver"],
    );
    expect(flags.map((flag) => flag.kind)).toEqual(["money", "percent", "date", "time", "weekday"]);
  });

  it("reads Chinese dates, times, and amounts", () => {
    const flags = findUnsupportedFacts("我們會於10月30日下午3點前提交，費用為5,000元。", ["盡快提交"]);
    expect(flags.map((flag) => [flag.kind, flag.text])).toEqual([
      ["money", "5,000元"],
      ["date", "10月30日"],
      ["time", "下午3點"],
    ]);
  });

  it("flags placeholders even though nothing is invented", () => {
    expect(findUnsupportedFacts("Meeting on [date] at 【時間】.", ["meeting"])).toEqual([
      { kind: "placeholder", text: "[date]" },
      { kind: "placeholder", text: "【時間】" },
    ]);
  });

  it("does not flag single digits or the person's own signature", () => {
    expect(
      findUnsupportedFacts("I need 2 more days.\nRick\n+852 9123 4567", ["need more days", "Rick\n+852 9123 4567"]),
    ).toEqual([]);
  });

  it("flags an unknown address or link once", () => {
    const flags = findUnsupportedFacts(
      "Write to sales@abc.com or see https://abc.com/terms — sales@abc.com again.",
      ["contact them"],
    );
    expect(flags).toEqual([
      { kind: "url", text: "https://abc.com/terms" },
      { kind: "email", text: "sales@abc.com" },
    ]);
  });
});

describe("draft links", () => {
  const draft = { to: "peter@abc.com", subject: "報價 & next steps", body: "Hi Peter,\nSee below + attached." };

  it("only puts a real address in the recipient", () => {
    expect(recipientAddress("peter@abc.com")).toBe("peter@abc.com");
    expect(recipientAddress("Peter")).toBeNull();
  });

  it("fills Gmail's compose window without sending", () => {
    const url = new URL(gmailComposeUrl(draft));
    expect(url.origin).toBe("https://mail.google.com");
    expect(url.searchParams.get("view")).toBe("cm");
    expect(url.searchParams.get("to")).toBe("peter@abc.com");
    expect(url.searchParams.get("su")).toBe("報價 & next steps");
    expect(url.searchParams.get("body")).toBe("Hi Peter,\nSee below + attached.");
  });

  it("encodes mailto so '+' and newlines survive", () => {
    const url = mailtoUrl({ ...draft, to: null });
    expect(url.startsWith("mailto:?subject=")).toBe(true);
    expect(url).toContain("%2B");
    expect(decodeURIComponent(url.split("body=")[1])).toBe(draft.body);
  });
});
