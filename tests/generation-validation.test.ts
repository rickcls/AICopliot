import { describe, expect, it } from "vitest";
import { modelProjectPlanSchema } from "@/lib/generation/schemas";
import {
  PlanValidationError,
  validateProjectPlan,
  type GenerationSource,
} from "@/lib/generation/validate";

function source(id: string, content = "Evidence for the project plan."): GenerationSource {
  return {
    id: `chunk-${id}`,
    documentId: `doc-${id}`,
    filename: `${id}.md`,
    content,
    chunkIndex: 0,
    pageNumber: 1,
    sectionTitle: "Plan",
  };
}

const sourceMap = new Map([
  ["S1", source("one", "Build the API before UAT. UAT sign-off is required.")],
  ["S2", source("two", "Production launch is scheduled after UAT.")],
]);

const cite = (sourceId = "S1", quote = "Build the API before UAT") => [
  { sourceId, quote },
];

function parse(value: unknown) {
  return modelProjectPlanSchema.parse(value);
}

describe("validateProjectPlan", () => {
  it("drops unknown source labels and an item left with no valid citation", () => {
    const result = validateProjectPlan(
      parse({
        tasks: [
          { ref: "T1", title: "Unsupported task", citations: cite("S99") },
          { ref: "T2", title: "Supported task", citations: cite() },
        ],
      }),
      sourceMap,
    );

    expect(result.tasks.map((task) => task.ref)).toEqual(["T2"]);
    expect(result.droppedSourceIds).toEqual(["S99"]);
    expect(result.warnings.join(" ")).toMatch(/uncited task/i);
  });

  it("drops an empty-citation item without invalidating cited siblings", () => {
    const result = validateProjectPlan(
      parse({
        tasks: [
          { ref: "T1", title: "Empty citations", citations: [] },
          { ref: "T2", title: "Supported task", citations: cite() },
        ],
      }),
      sourceMap,
    );
    expect(result.tasks.map((task) => task.ref)).toEqual(["T2"]);
  });

  it("uses source text instead of rendering a fabricated quote", () => {
    const result = validateProjectPlan(
      parse({
        milestones: [
          {
            ref: "M1",
            title: "UAT",
            citations: cite("S1", "words that are not in the source"),
          },
        ],
      }),
      sourceMap,
    );
    expect(result.milestones[0].citations[0].excerpt).toBe(
      "Build the API before UAT. UAT sign-off is required.",
    );
  });

  it("clears only an unsupported milestone link and keeps the cited task", () => {
    const result = validateProjectPlan(
      parse({
        milestones: [{ ref: "M1", title: "UAT", citations: cite() }],
        tasks: [
          {
            ref: "T1",
            title: "Prepare UAT",
            milestoneRef: "M1",
            citations: cite(),
            milestoneCitations: cite("S99"),
          },
        ],
      }),
      sourceMap,
    );

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].milestoneRef).toBeNull();
    expect(result.tasks[0].milestoneCitations).toEqual([]);
  });

  it("does not retain orphan milestone-link citations without an association", () => {
    const result = validateProjectPlan(
      parse({
        tasks: [
          {
            ref: "T1",
            title: "Unlinked task",
            milestoneRef: null,
            citations: cite(),
            milestoneCitations: cite("S2", "Production launch"),
          },
        ],
        risks: [
          {
            description: "Unlinked risk",
            milestoneRef: null,
            citations: cite(),
            milestoneCitations: cite("S2", "Production launch"),
          },
        ],
      }),
      sourceMap,
    );
    expect(result.tasks[0].milestoneCitations).toEqual([]);
    expect(result.risks[0].milestoneCitations).toEqual([]);
  });

  it("removes inverted tasks, duplicate edges, self edges, and cycles", () => {
    const result = validateProjectPlan(
      parse({
        tasks: [
          { ref: "T1", title: "API", citations: cite() },
          { ref: "T2", title: "UAT", citations: cite() },
          {
            ref: "T3",
            title: "Bad schedule",
            startDate: "2026-09-02",
            dueDate: "2026-09-01",
            citations: cite(),
          },
        ],
        dependencies: [
          { taskRef: "T2", dependsOnTaskRef: "T1", citations: cite() },
          { taskRef: "T2", dependsOnTaskRef: "T1", citations: cite() },
          { taskRef: "T1", dependsOnTaskRef: "T1", citations: cite() },
          { taskRef: "T1", dependsOnTaskRef: "T2", citations: cite() },
          { taskRef: "T3", dependsOnTaskRef: "T1", citations: cite() },
        ],
      }),
      sourceMap,
    );

    expect(result.tasks.map((task) => task.ref)).toEqual(["T1", "T2"]);
    expect(result.dependencies).toEqual([
      expect.objectContaining({ taskRef: "T2", dependsOnTaskRef: "T1" }),
    ]);
    expect(result.warnings.join(" ")).toMatch(/cyclic dependency/i);
  });

  it("fails the run when no task, milestone, or risk survives", () => {
    expect(() =>
      validateProjectPlan(
        parse({
          scopeStatements: [{ text: "Scope", citations: cite() }],
          tasks: [{ ref: "T1", title: "Unsupported", citations: cite("S99") }],
        }),
        sourceMap,
      ),
    ).toThrow(PlanValidationError);
  });

  it("deduplicates proposal titles without collapsing different proposal kinds", () => {
    const result = validateProjectPlan(
      parse({
        milestones: [{ ref: "M1", title: "Launch", citations: cite() }],
        tasks: [
          { ref: "T1", title: "Launch", citations: cite() },
          { ref: "T2", title: "  launch  ", citations: cite() },
        ],
        risks: [{ description: "Launch", citations: cite() }],
      }),
      sourceMap,
    );
    expect(result.milestones).toHaveLength(1);
    expect(result.tasks).toHaveLength(1);
    expect(result.risks).toHaveLength(1);
  });
});
