import { describe, expect, it } from "vitest";
import {
  applyTaskFill,
  type FillableDraft,
  type TaskFillResult,
} from "@/lib/pm/task-fill-apply";

const blank: FillableDraft = {
  description: "",
  priority: "medium",
  estimatedHours: "",
  startDate: "",
  dueDate: "",
  documentIds: [],
  citations: [],
  requirementIds: [],
};

function result(fill: Partial<TaskFillResult["fill"]>): TaskFillResult {
  return {
    fill: {
      description: null,
      priority: null,
      estimatedHours: null,
      startDate: null,
      dueDate: null,
      requirements: [],
      ...fill,
    },
    sources: [
      {
        chunkId: "chunk-1",
        documentId: "doc-1",
        filename: "kickoff.md",
        pageNumber: null,
        sectionTitle: null,
        excerpt: "by 15 October 2026",
        fields: ["dueDate"],
      },
      {
        chunkId: "chunk-2",
        documentId: "doc-2",
        filename: "brief.md",
        pageNumber: 3,
        sectionTitle: null,
        excerpt: "migrate the data",
        fields: ["description"],
      },
    ],
    dropped: [],
    evidence: "project",
    modelName: "fake",
    latencyMs: 1,
  };
}

describe("applyTaskFill", () => {
  it("fills every blank field and records where each value came from", () => {
    const applied = applyTaskFill(
      blank,
      result({
        description: "Migrate the data.",
        priority: "high",
        estimatedHours: 16,
        dueDate: "2026-10-15",
        requirements: [
          { id: "req-1", code: "REQ-001", title: "Migrate data", status: "approved" },
        ],
      }),
      { priorityIsBlank: true },
    );

    expect(applied.draft).toMatchObject({
      description: "Migrate the data.",
      priority: "high",
      estimatedHours: "16",
      dueDate: "2026-10-15",
      requirementIds: ["req-1"],
      documentIds: ["doc-1", "doc-2"],
      citations: [
        { chunkId: "chunk-1", quote: "by 15 October 2026" },
        { chunkId: "chunk-2", quote: "migrate the data" },
      ],
    });
    expect(applied.filled).toEqual(["description", "priority", "estimatedHours", "dueDate"]);
    expect(applied.kept).toEqual([]);
  });

  it("never overwrites what the user already entered", () => {
    const applied = applyTaskFill(
      { ...blank, description: "My own words", dueDate: "2026-11-01" },
      result({ description: "Migrate the data.", dueDate: "2026-10-15" }),
      { priorityIsBlank: true },
    );
    expect(applied.draft.description).toBe("My own words");
    expect(applied.draft.dueDate).toBe("2026-11-01");
    expect(applied.kept).toEqual(["description", "dueDate"]);
    // Nothing was filled, so no source is claimed and nothing gets linked.
    expect(applied.sources).toEqual([]);
    expect(applied.draft.citations).toEqual([]);
    expect(applied.draft.documentIds).toEqual([]);
  });

  it("leaves a priority the user chose, even when it is medium", () => {
    const applied = applyTaskFill(blank, result({ priority: "urgent" }), {
      priorityIsBlank: false,
    });
    expect(applied.draft.priority).toBe("medium");
    expect(applied.kept).toEqual(["priority"]);
  });

  it("holds back a start date that would land after the due date already set", () => {
    const applied = applyTaskFill(
      { ...blank, dueDate: "2026-10-01" },
      result({ startDate: "2026-10-10" }),
      { priorityIsBlank: true },
    );
    expect(applied.draft.startDate).toBe("");
    expect(applied.kept).toEqual(["startDate"]);
  });

  it("adds only requirements that are not linked yet", () => {
    const applied = applyTaskFill(
      { ...blank, requirementIds: ["req-1"] },
      result({
        requirements: [
          { id: "req-1", code: "REQ-001", title: "A", status: "approved" },
          { id: "req-2", code: "REQ-002", title: "B", status: "draft" },
          { id: "req-3", code: "REQ-003", title: "C", status: "draft" },
        ],
      }),
      { priorityIsBlank: true, linkedRequirementIds: ["req-3"] },
    );
    expect(applied.draft.requirementIds).toEqual(["req-1", "req-2"]);
    expect(applied.requirements.map((requirement) => requirement.id)).toEqual(["req-2"]);
  });

  it("does not link a document twice or repeat a citation", () => {
    const applied = applyTaskFill(
      {
        ...blank,
        documentIds: ["doc-1"],
        citations: [{ chunkId: "chunk-1", quote: "earlier" }],
      },
      result({ dueDate: "2026-10-15" }),
      { priorityIsBlank: true },
    );
    expect(applied.draft.documentIds).toEqual(["doc-1"]);
    expect(applied.draft.citations).toEqual([{ chunkId: "chunk-1", quote: "earlier" }]);
  });
});
