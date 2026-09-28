import { describe, expect, it } from "vitest";
import { modelTaskFillSchema } from "@/lib/generation/schemas";
import {
  sourceStatesDate,
  sourceStatesEffort,
  validateTaskFill,
} from "@/lib/generation/task-fill-validate";
import type { GenerationSourceMap } from "@/lib/generation/validate";

const sourceMap: GenerationSourceMap = new Map([
  [
    "S1",
    {
      id: "chunk-1",
      documentId: "doc-1",
      filename: "kickoff.md",
      content:
        "The vendor must deliver the data migration by 15 October 2026. Effort is estimated at 3 days.",
      chunkIndex: 0,
      pageNumber: null,
      sectionTitle: null,
    },
  ],
  [
    "S2",
    {
      id: "chunk-2",
      documentId: "doc-2",
      filename: "notes.md",
      content: "Testing starts two weeks after kickoff.",
      chunkIndex: 0,
      pageNumber: null,
      sectionTitle: null,
    },
  ],
]);

const requirementLabels = new Map([
  ["Q1", "req-1"],
  ["Q2", "req-2"],
]);

function parse(value: unknown) {
  return modelTaskFillSchema.parse(value);
}

describe("modelTaskFillSchema", () => {
  it("turns one malformed field into null instead of rejecting the reply", () => {
    const parsed = parse({
      description: { text: "Migrate the data.", citations: [{ sourceId: "S1" }] },
      dueDate: { value: "15/10/2026", citations: [{ sourceId: "S1" }] },
      priority: { value: "critical", citations: [] },
    });
    expect(parsed.description?.text).toBe("Migrate the data.");
    expect(parsed.dueDate).toBeNull();
    expect(parsed.priority).toBeNull();
    expect(parsed.requirements).toEqual([]);
  });
});

describe("validateTaskFill", () => {
  it("keeps cited values and resolves requirement labels to ids", () => {
    const result = validateTaskFill(
      parse({
        description: {
          text: "Deliver the data migration.",
          citations: [{ sourceId: "S1", quote: "deliver the data migration" }],
        },
        priority: { value: "high", citations: [{ sourceId: "s1" }] },
        estimatedHours: { value: 24, citations: [{ sourceId: "S1" }] },
        dueDate: { value: "2026-10-15", citations: [{ sourceId: "S1" }] },
        requirements: ["Q2", "q2", "Q9"],
      }),
      sourceMap,
      requirementLabels,
    );

    expect(result.description?.value).toBe("Deliver the data migration.");
    expect(result.description?.citations[0]).toMatchObject({
      chunkId: "chunk-1",
      excerpt: "deliver the data migration",
    });
    expect(result.priority?.value).toBe("high");
    expect(result.estimatedHours?.value).toBe(24);
    expect(result.dueDate?.value).toBe("2026-10-15");
    // Duplicates collapse and an unknown label resolves to nothing.
    expect(result.requirementIds).toEqual(["req-2"]);
    expect(result.dropped).toEqual([]);
  });

  it("drops a value whose only citation is a label the model was never given", () => {
    const result = validateTaskFill(
      parse({
        description: { text: "Something plausible.", citations: [{ sourceId: "S7" }] },
        priority: { value: "urgent", citations: [] },
      }),
      sourceMap,
      requirementLabels,
    );
    expect(result.description).toBeNull();
    expect(result.priority).toBeNull();
    expect(result.dropped).toEqual(["description", "priority"]);
  });

  it("drops a calendar date the cited source never states", () => {
    const result = validateTaskFill(
      parse({
        // "two weeks after kickoff" is timing, not a date.
        startDate: { value: "2026-10-01", citations: [{ sourceId: "S2" }] },
        dueDate: { value: "2026-10-15", citations: [{ sourceId: "S1" }] },
      }),
      sourceMap,
      requirementLabels,
    );
    expect(result.startDate).toBeNull();
    expect(result.dueDate?.value).toBe("2026-10-15");
    expect(result.dropped).toEqual(["startDate"]);
  });

  it("drops an estimate the cited source does not state", () => {
    const result = validateTaskFill(
      parse({ estimatedHours: { value: 40, citations: [{ sourceId: "S1" }] } }),
      sourceMap,
      requirementLabels,
    );
    expect(result.estimatedHours).toBeNull();
    expect(result.dropped).toEqual(["estimatedHours"]);
  });

  it("gives up the start date when it falls after the due date", () => {
    const map: GenerationSourceMap = new Map([
      [
        "S1",
        {
          ...sourceMap.get("S1")!,
          content: "Work begins 20 October 2026 and is due 15 October 2026.",
        },
      ],
    ]);
    const result = validateTaskFill(
      parse({
        startDate: { value: "2026-10-20", citations: [{ sourceId: "S1" }] },
        dueDate: { value: "2026-10-15", citations: [{ sourceId: "S1" }] },
      }),
      map,
      requirementLabels,
    );
    expect(result.startDate).toBeNull();
    expect(result.dueDate?.value).toBe("2026-10-15");
  });
});

describe("sourceStatesDate", () => {
  it.each([
    ["Due 15 October 2026.", "2026-10-15", true],
    ["Due 2026-10-05.", "2026-10-05", true],
    ["Due October 5th, 2026.", "2026-10-05", true],
    ["Due by 15 Oct.", "2026-10-15", false],
    ["Go-live end of Q4 2026.", "2026-12-31", false],
    ["Budget 12026 approved on day 15.", "2026-10-15", false],
  ])("%s → %s is %s", (content, day, expected) => {
    expect(sourceStatesDate(content, day)).toBe(expected);
  });
});

describe("sourceStatesEffort", () => {
  it.each([
    ["About 16 hours of work.", 16, true],
    ["Roughly 2 days of effort.", 16, true],
    ["Half a day, 0.5 days.", 4, true],
    ["A few days.", 24, false],
    ["Budget 160 hours.", 16, false],
  ])("%s → %s hours is %s", (content, hours, expected) => {
    expect(sourceStatesEffort(content, hours)).toBe(expected);
  });
});
