import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { zhHant } from "@/lib/i18n/dictionaries/zh-Hant";
import { createTranslator, type Dictionary } from "@/lib/i18n/translate";

describe("createTranslator", () => {
  const tEn = createTranslator("en", en, en);
  const tZh = createTranslator("zh-Hant", zhHant, en);

  it("reads a nested key in the requested language", () => {
    expect(tEn("nav.today")).toBe("Today");
    expect(tZh("nav.today")).toBe("今日");
  });

  it("interpolates named variables", () => {
    expect(tEn("nav.signOutAs", { email: "a@b.co" })).toBe("Sign out (a@b.co)");
    expect(tZh("today.dueOn", { date: "2026年10月16日" })).toBe("2026年10月16日 到期");
  });

  it("leaves an unknown placeholder visible rather than blank", () => {
    expect(tEn("nav.signOutAs")).toBe("Sign out ({email})");
  });

  it("picks the English plural form from the count", () => {
    expect(tEn("today.later", { count: 1 })).toBe(
      "1 more open task has no date or is due later.",
    );
    expect(tEn("today.later", { count: 3 })).toBe(
      "3 more open tasks have no date or are due later.",
    );
  });

  it("uses the other form for every Chinese count", () => {
    expect(tZh("today.later", { count: 1 })).toContain("1 項");
    expect(tZh("today.later", { count: 2 })).toContain("2 項");
  });

  it("falls back to English when a dictionary lacks a key", () => {
    const partial = { ...zhHant, nav: { ...zhHant.nav, today: undefined } };
    const t = createTranslator("zh-Hant", partial as unknown as Dictionary, en);
    expect(t("nav.today")).toBe("Today");
  });

  it("renders the key itself when no dictionary has it", () => {
    const t = createTranslator("en", {} as Dictionary, {} as Dictionary);
    expect(t("nav.today")).toBe("nav.today");
  });
});
