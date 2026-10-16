import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { zhHant } from "@/lib/i18n/dictionaries/zh-Hant";
import { displayStatusLabel } from "@/lib/i18n/status-labels";
import { createTranslator } from "@/lib/i18n/translate";

describe("displayStatusLabel", () => {
  const t = createTranslator("zh-Hant", zhHant, en);

  it("translates a seeded column that still has its seeded label", () => {
    expect(displayStatusLabel({ key: "in_progress", label: "In progress" }, t)).toBe(
      "進行中",
    );
    expect(displayStatusLabel({ key: "done", label: "Done" }, t)).toBe("已完成");
  });

  it("shows a renamed seeded column exactly as the team typed it", () => {
    expect(displayStatusLabel({ key: "in_progress", label: "Doing" }, t)).toBe("Doing");
  });

  it("shows a custom column's label untouched", () => {
    expect(displayStatusLabel({ key: "qa", label: "QA" }, t)).toBe("QA");
  });
});
