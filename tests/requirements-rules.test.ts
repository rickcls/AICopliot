import { describe, expect, it } from "vitest";
import {
  baselinedRequirementWhere,
  formatRequirementCode,
  requirementGenerationStatusFor,
  uncoveredRequirementWhere,
  unvalidatedRequirementWhere,
  OFFICIAL_RECORD_FILTER,
  OPEN_REQUIREMENT_STATUSES,
} from "@/lib/pm/rules";

const OFFICIAL_OR = [
  { source: "manual", generationStatus: "not_applicable" },
  { source: "ai_suggested", generationStatus: "approved" },
];

describe("formatRequirementCode", () => {
  it("zero-pads to three digits so short registers align", () => {
    expect(formatRequirementCode(1)).toBe("REQ-001");
    expect(formatRequirementCode(42)).toBe("REQ-042");
    expect(formatRequirementCode(999)).toBe("REQ-999");
  });

  it("keeps going past the padding width rather than truncating", () => {
    expect(formatRequirementCode(1000)).toBe("REQ-1000");
  });
});

describe("requirementGenerationStatusFor", () => {
  it("never touches the review axis of a manual record", () => {
    for (const status of [
      "draft",
      "needs_clarification",
      "validated",
      "approved",
      "rejected",
    ] as const) {
      expect(requirementGenerationStatusFor("manual", status)).toBeUndefined();
    }
  });

  it("leaves the column alone when no status change was requested", () => {
    expect(requirementGenerationStatusFor("ai_suggested", undefined)).toBeUndefined();
  });

  it("keeps an AI record a proposal while it is still a draft", () => {
    expect(requirementGenerationStatusFor("ai_suggested", "draft")).toBe("draft");
  });

  it("records rejection on both axes", () => {
    expect(requirementGenerationStatusFor("ai_suggested", "rejected")).toBe(
      "rejected",
    );
  });

  it("treats any other transition as a human keeping the record", () => {
    // Moving a draft to "needs clarification" is still an acceptance of the
    // record itself — the reviewer read it and chose to carry it forward.
    expect(
      requirementGenerationStatusFor("ai_suggested", "needs_clarification"),
    ).toBe("approved");
    expect(requirementGenerationStatusFor("ai_suggested", "validated")).toBe(
      "approved",
    );
    expect(requirementGenerationStatusFor("ai_suggested", "approved")).toBe(
      "approved",
    );
  });
});

describe("requirement query builders", () => {
  it("requires both axes for baselined scope", () => {
    const where = baselinedRequirementWhere("ws-1", "project-1");

    expect(where).toMatchObject({
      workspaceId: "ws-1",
      projectId: "project-1",
      status: "approved",
    });
    expect(where.OR).toEqual(OFFICIAL_OR);
  });

  it("omits projectId when scoping across the workspace", () => {
    const where = baselinedRequirementWhere("ws-1");

    expect(where.workspaceId).toBe("ws-1");
    expect(where).not.toHaveProperty("projectId");
  });

  it("counts a requirement as covered only by an official task", () => {
    const where = uncoveredRequirementWhere("ws-1", "project-1");

    expect(where.links).toEqual({
      none: { targetType: "task", task: { OR: OFFICIAL_OR } },
    });
    // A draft task proposal must not make agreed scope look delivered.
    expect(where.links.none.task.OR).toEqual(OFFICIAL_OR);
  });

  it("treats a missing acceptance criterion as unvalidated", () => {
    const where = unvalidatedRequirementWhere("ws-1", "project-1");

    expect(where).toMatchObject({
      workspaceId: "ws-1",
      projectId: "project-1",
      status: "approved",
      acceptanceCriteria: null,
    });
  });

  it("keeps the official predicate's OR intact in every builder", () => {
    // officialRecordWhere overwrites any OR it is handed, so a builder that
    // needed its own would silently lose the invariant.
    for (const where of [
      baselinedRequirementWhere("ws-1", "p-1"),
      uncoveredRequirementWhere("ws-1", "p-1"),
      unvalidatedRequirementWhere("ws-1", "p-1"),
    ]) {
      expect(where.OR).toEqual([...OFFICIAL_RECORD_FILTER.OR]);
    }
  });
});

describe("OPEN_REQUIREMENT_STATUSES", () => {
  it("excludes the two terminal states", () => {
    expect([...OPEN_REQUIREMENT_STATUSES]).toEqual([
      "draft",
      "needs_clarification",
      "validated",
    ]);
  });
});
