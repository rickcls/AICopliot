import { describe, expect, it } from "vitest";
import {
  htmlLang,
  intlLocale,
  isLocale,
  matchAcceptLanguage,
} from "@/lib/i18n/locales";

describe("matchAcceptLanguage", () => {
  it("serves Traditional for every Chinese tag, Simplified included", () => {
    expect(matchAcceptLanguage("zh-HK,zh;q=0.9")).toBe("zh-Hant");
    expect(matchAcceptLanguage("zh-CN")).toBe("zh-Hant");
    expect(matchAcceptLanguage("zh")).toBe("zh-Hant");
  });

  it("honours q-weights over list order", () => {
    expect(matchAcceptLanguage("en;q=0.5,zh-TW;q=0.9")).toBe("zh-Hant");
    expect(matchAcceptLanguage("zh-HK;q=0.3,en-GB")).toBe("en");
  });

  it("skips unsupported languages to the first supported one", () => {
    expect(matchAcceptLanguage("ja,fr;q=0.9,en;q=0.8")).toBe("en");
  });

  it("ignores languages refused with q=0", () => {
    expect(matchAcceptLanguage("zh;q=0,en")).toBe("en");
  });

  it("returns null when nothing matches or there is no header", () => {
    expect(matchAcceptLanguage("ja,fr")).toBeNull();
    expect(matchAcceptLanguage("")).toBeNull();
    expect(matchAcceptLanguage(null)).toBeNull();
  });
});

describe("locale helpers", () => {
  it("recognises only supported locales", () => {
    expect(isLocale("zh-Hant")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("zh-Hans")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it("maps to Hong Kong tags for HTML and Intl", () => {
    expect(htmlLang("zh-Hant")).toBe("zh-Hant-HK");
    expect(intlLocale("zh-Hant")).toBe("zh-HK");
    expect(intlLocale("en")).toBe("en-GB");
  });
});
