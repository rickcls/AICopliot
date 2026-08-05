import { describe, expect, it } from "vitest";
import {
  createRequirementLinkSchema,
  createRequirementSchema,
  updateRequirementSchema,
} from "@/lib/schemas";

describe("createRequirementSchema", () => {
  it("defaults a new requirement to an unagreed draft", () => {
    const parsed = createRequirementSchema.parse({ title: "Managers approve leave" });

    expect(parsed).toMatchObject({
      type: "functional",
      priority: "should",
      status: "draft",
      confidence: "medium",
    });
  });

  it("requires a title", () => {
    expect(createRequirementSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(createRequirementSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a MoSCoW value that is not one of the four", () => {
    expect(
      createRequirementSchema.safeParse({ title: "x", priority: "critical" }).success,
    ).toBe(false);
  });
});

describe("updateRequirementSchema", () => {
  it("carries no defaults, so a status PATCH changes only the status", () => {
    // The invariant-22 regression: .partial() does not strip .default(), so a
    // defaulted field would materialise here and silently overwrite a value the
    // caller never mentioned.
    const parsed = updateRequirementSchema.parse({ status: "approved" });

    expect(parsed).toEqual({ status: "approved" });
    expect(parsed).not.toHaveProperty("priority");
    expect(parsed).not.toHaveProperty("type");
    expect(parsed).not.toHaveProperty("confidence");
  });

  it("rejects an empty body so a PATCH always states what it changes", () => {
    expect(updateRequirementSchema.safeParse({}).success).toBe(false);
  });

  it("keeps omitted text distinct from cleared text", () => {
    const omitted = updateRequirementSchema.parse({ title: "x" });
    expect(omitted.acceptanceCriteria).toBeUndefined();

    // Both spellings of "clear it" collapse to null; neither is confused with
    // "leave it alone".
    expect(
      updateRequirementSchema.parse({ acceptanceCriteria: "" }).acceptanceCriteria,
    ).toBeNull();
    expect(
      updateRequirementSchema.parse({ acceptanceCriteria: null }).acceptanceCriteria,
    ).toBeNull();
  });

  it("accepts every lifecycle status", () => {
    for (const status of [
      "draft",
      "needs_clarification",
      "validated",
      "approved",
      "rejected",
    ]) {
      expect(updateRequirementSchema.safeParse({ status }).success).toBe(true);
    }
  });
});

describe("createRequirementLinkSchema", () => {
  it("accepts the three delivery record kinds", () => {
    for (const targetType of ["task", "milestone", "risk"]) {
      expect(
        createRequirementLinkSchema.safeParse({ targetType, targetId: "id-1" })
          .success,
      ).toBe(true);
    }
  });

  it("rejects an unknown target kind or a missing id", () => {
    expect(
      createRequirementLinkSchema.safeParse({
        targetType: "document",
        targetId: "id-1",
      }).success,
    ).toBe(false);
    expect(
      createRequirementLinkSchema.safeParse({ targetType: "task", targetId: "" })
        .success,
    ).toBe(false);
  });
});
