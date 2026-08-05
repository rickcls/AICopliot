import { describe, expect, it } from "vitest";
import {
  createGenerationRunSchema,
  modelProjectPlanSchema,
  reviewRiskChangesSchema,
  reviewTaskChangesSchema,
} from "@/lib/generation/schemas";

const citation = { sourceId: "S1", quote: "Evidence" };

describe("generation request schemas", () => {
  it("deduplicates document IDs before enforcing the 20-document limit", () => {
    const result = createGenerationRunSchema.parse({
      documentIds: Array.from({ length: 25 }, () => "doc-1"),
    });
    expect(result.documentIds).toEqual(["doc-1"]);
  });

  it("rejects more than 20 distinct documents", () => {
    const result = createGenerationRunSchema.safeParse({
      documentIds: Array.from({ length: 21 }, (_, index) => `doc-${index}`),
    });
    expect(result.success).toBe(false);
  });

  it("accepts milestone link edits for draft tasks and risks", () => {
    expect(reviewTaskChangesSchema.parse({ milestoneId: "milestone-1" })).toEqual({
      milestoneId: "milestone-1",
    });
    expect(reviewRiskChangesSchema.parse({ milestoneId: null })).toEqual({
      milestoneId: null,
    });
  });
});

describe("model plan bounds", () => {
  it("accepts the highest valid local references", () => {
    const parsed = modelProjectPlanSchema.safeParse({
      milestones: [
        {
          ref: "M12",
          title: "Launch",
          citations: [citation],
        },
      ],
      tasks: [
        {
          ref: "T40",
          title: "Release",
          milestoneRef: "M12",
          citations: [citation],
          milestoneCitations: [citation],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects M13 and T41 even though they match the prefix regex", () => {
    expect(
      modelProjectPlanSchema.safeParse({
        milestones: [{ ref: "M13", title: "Too far", citations: [citation] }],
      }).success,
    ).toBe(false);
    expect(
      modelProjectPlanSchema.safeParse({
        tasks: [{ ref: "T41", title: "Too far", citations: [citation] }],
      }).success,
    ).toBe(false);
  });

  it("rejects noncanonical leading-zero references", () => {
    expect(
      modelProjectPlanSchema.safeParse({
        milestones: [{ ref: "M01", title: "Leading zero", citations: [citation] }],
      }).success,
    ).toBe(false);
    expect(
      modelProjectPlanSchema.safeParse({
        tasks: [{ ref: "T001", title: "Leading zero", citations: [citation] }],
      }).success,
    ).toBe(false);
  });

  it("rejects output arrays beyond their contract limits", () => {
    const result = modelProjectPlanSchema.safeParse({
      risks: Array.from({ length: 21 }, (_, index) => ({
        description: `Risk ${index}`,
        citations: [citation],
      })),
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid or inverted calendar dates at the contract boundary", () => {
    expect(
      modelProjectPlanSchema.safeParse({
        tasks: [
          {
            ref: "T1",
            title: "Invalid calendar date",
            dueDate: "2026-02-30",
            citations: [citation],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
