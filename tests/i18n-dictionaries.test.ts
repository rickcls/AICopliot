import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { zhHant } from "@/lib/i18n/dictionaries/zh-Hant";
import { containsSimplified } from "@/lib/language";

/** Every leaf as [dotted.key, text], plural forms included. */
function leaves(node: unknown, prefix = ""): [string, string][] {
  if (typeof node === "string") return [[prefix, node]];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leaves(value, prefix ? `${prefix}.${key}` : key),
  );
}

/**
 * The type-check already rejects a missing key (`satisfies Dictionary`); this
 * also catches extra keys, empty strings, mismatched placeholders, and — the
 * one a reviewer reading Chinese quickly would miss — Simplified characters.
 */
describe("dictionaries", () => {
  const enLeaves = new Map(leaves(en));
  const zhLeaves = new Map(leaves(zhHant));

  it("have exactly the same keys", () => {
    expect([...zhLeaves.keys()].sort()).toEqual([...enLeaves.keys()].sort());
  });

  it("have no empty messages", () => {
    for (const [key, text] of [...enLeaves, ...zhLeaves]) {
      expect(text.trim(), key).not.toBe("");
    }
  });

  it("use the same placeholders in both languages", () => {
    const placeholders = (text: string) =>
      [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const [key, text] of enLeaves) {
      expect(placeholders(zhLeaves.get(key) ?? ""), key).toEqual(placeholders(text));
    }
  });

  it("contain no Simplified Chinese characters", () => {
    for (const [key, text] of zhLeaves) {
      expect(containsSimplified(text), `${key}: ${text}`).toBe(false);
    }
  });
});
