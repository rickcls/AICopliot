import { describe, expect, it } from "vitest";
import { resolveDateExpression } from "@/lib/capture/dates";

/** Anchored on Friday 16 October 2026, the day the capture was written. */
const ANCHOR = "2026-10-16";
const resolve = (phrase: string) => resolveDateExpression(phrase, ANCHOR);

describe("resolveDateExpression — Cantonese and written Chinese", () => {
  it.each([
    ["今日", "2026-10-16"],
    ["今晚", "2026-10-16"],
    ["聽日", "2026-10-17"],
    ["聽日下晝3點前", "2026-10-17"],
    ["明天", "2026-10-17"],
    ["後日", "2026-10-18"],
    ["大後日", "2026-10-19"],
    ["星期五", "2026-10-16"],
    ["禮拜一", "2026-10-19"],
    ["週三", "2026-10-21"],
    ["下星期五", "2026-10-23"],
    ["下禮拜一", "2026-10-19"],
    ["下個星期日", "2026-10-25"],
    ["今個星期一", "2026-10-12"],
    ["本週三", "2026-10-14"],
    ["月尾", "2026-10-31"],
    ["下個月尾", "2026-11-30"],
    ["3日後", "2026-10-19"],
    ["十日後", "2026-10-26"],
    ["10月23日", "2026-10-23"],
    ["10月23號", "2026-10-23"],
    ["2027年1月5日", "2027-01-05"],
    ["23號", "2026-10-23"],
    ["5號", "2026-11-05"],
    ["下個月5號", "2026-11-05"],
  ])("%s → %s", (phrase, expected) => {
    expect(resolve(phrase)).toBe(expected);
  });
});

describe("resolveDateExpression — English and numeric", () => {
  it.each([
    ["today", "2026-10-16"],
    ["by EOD", "2026-10-16"],
    ["tomorrow", "2026-10-17"],
    ["tmr", "2026-10-17"],
    ["day after tomorrow", "2026-10-18"],
    ["Friday", "2026-10-16"],
    ["by Thursday", "2026-10-22"],
    ["next Friday", "2026-10-23"],
    ["next Monday", "2026-10-19"],
    ["end of the week", "2026-10-16"],
    ["end of month", "2026-10-31"],
    ["in 3 days", "2026-10-19"],
    ["23/10", "2026-10-23"],
    ["23/10/2026", "2026-10-23"],
    ["23/10/26", "2026-10-23"],
    ["3/1", "2027-01-03"],
    ["2026-11-02", "2026-11-02"],
    ["23 Oct", "2026-10-23"],
    ["23rd October 2026", "2026-10-23"],
    ["Oct 23", "2026-10-23"],
    ["November 2nd", "2026-11-02"],
  ])("%s → %s", (phrase, expected) => {
    expect(resolve(phrase)).toBe(expected);
  });
});

describe("resolveDateExpression — refuses to guess", () => {
  it.each([
    "下星期",
    "遲啲",
    "盡快",
    "ASAP",
    "soon",
    "next week",
    "最後日期",
    "說明",
    "31/2",
    "12.10",
    "",
  ])("%s → null", (phrase) => {
    expect(resolve(phrase)).toBeNull();
  });

  it("lets a stray number fall through to the real date beside it", () => {
    expect(resolve("聽日 12.10")).toBe("2026-10-17");
  });

  it("rolls a no-year date into next year only when it is well in the past", () => {
    expect(resolveDateExpression("1/9", "2026-10-16")).toBe("2026-09-01");
    expect(resolveDateExpression("1/8", "2026-10-16")).toBe("2027-08-01");
  });

  it("returns null for an invalid anchor", () => {
    expect(resolveDateExpression("聽日", "not-a-date")).toBeNull();
  });
});
