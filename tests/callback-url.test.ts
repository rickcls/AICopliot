import { describe, expect, it } from "vitest";
import { safeCallbackUrl } from "@/lib/auth/callback-url";

describe("safeCallbackUrl", () => {
  it("keeps a path on this site, with its query and hash", () => {
    expect(safeCallbackUrl("/invite/abc_DEF-123")).toBe("/invite/abc_DEF-123");
    expect(safeCallbackUrl("/projects/p1/tasks?task=t1#x")).toBe(
      "/projects/p1/tasks?task=t1#x",
    );
  });

  it("refuses anything that would leave the site", () => {
    for (const value of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "/\tjavascript:alert(1)",
      "evil.example",
    ]) {
      expect(safeCallbackUrl(value), value).toBe("/today");
    }
  });

  it("falls back for missing or oversized values", () => {
    expect(safeCallbackUrl(undefined)).toBe("/today");
    expect(safeCallbackUrl("")).toBe("/today");
    expect(safeCallbackUrl(`/${"a".repeat(600)}`)).toBe("/today");
    expect(safeCallbackUrl(["/today"], "/x")).toBe("/x");
  });
});
