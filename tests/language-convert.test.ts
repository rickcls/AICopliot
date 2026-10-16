import { describe, expect, it } from "vitest";
import { containsSimplified } from "@/lib/language";
import { toTraditional } from "@/lib/language-convert";

describe("toTraditional", () => {
  it("converts Simplified to Hong Kong Traditional", () => {
    const converted = toTraditional("这个报告请发给客户");
    expect(converted).toBe("這個報告請發給客户");
    expect(containsSimplified(converted)).toBe(false);
  });

  it("leaves Traditional text and English untouched", () => {
    expect(toTraditional("聽日要send個report俾client")).toBe("聽日要send個report俾client");
    expect(toTraditional("面試、公里、游泳")).toBe("面試、公里、游泳");
  });
});
