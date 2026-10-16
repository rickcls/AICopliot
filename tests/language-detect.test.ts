import { describe, expect, it } from "vitest";
import {
  containsSimplified,
  detectReplyLanguage,
  languageDirective,
} from "@/lib/language";

describe("detectReplyLanguage", () => {
  it("reads plain English as English", () => {
    expect(detectReplyLanguage("Send the quote to ABC by Friday", "zh-Hant")).toBe("en");
  });

  it("reads written Chinese as Traditional Chinese", () => {
    expect(detectReplyLanguage("請於星期五前把報價單寄給客戶", "en")).toBe("zh-Hant");
  });

  it("reads Hong Kong code-mixing as Chinese", () => {
    expect(detectReplyLanguage("聽日要send個report俾client", "en")).toBe("zh-Hant");
    expect(detectReplyLanguage("聽日下晝3點前要send報價俾ABC公司", "en")).toBe("zh-Hant");
  });

  it("keeps an English sentence with a Chinese name in English", () => {
    expect(detectReplyLanguage("Please email 陳生 tomorrow about it", "zh-Hant")).toBe("en");
  });

  it("uses the fallback when there are no words to judge", () => {
    expect(detectReplyLanguage("2026-10-16 15:00", "zh-Hant")).toBe("zh-Hant");
    expect(detectReplyLanguage("  ", "en")).toBe("en");
  });
});

describe("containsSimplified", () => {
  it("flags Simplified-only characters", () => {
    expect(containsSimplified("这个报告")).toBe(true);
    expect(containsSimplified("请发给我")).toBe(true);
  });

  it("does not flag characters Traditional text also uses", () => {
    expect(containsSimplified("面試、公里、表格、游泳、降落、范先生")).toBe(false);
    expect(containsSimplified("這個報告請發給我")).toBe(false);
    expect(containsSimplified("Send the report")).toBe(false);
  });
});

describe("languageDirective", () => {
  it("forbids Simplified characters for Chinese output", () => {
    expect(languageDirective("zh-Hant")).toContain("Never use Simplified");
    expect(languageDirective("en")).toContain("English");
  });
});
