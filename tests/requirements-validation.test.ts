import { describe, expect, it } from "vitest";
import { modelRequirementsSchema } from "@/lib/generation/schemas";
import { validateRequirements } from "@/lib/generation/requirements-validate";
import { PlanValidationError, type GenerationSourceMap } from "@/lib/generation/validate";

const chunk = {
  id: "chunk-1",
  documentId: "doc-1",
  filename: "brief.md",
  content: "All administrative access must be secure. Managers approve leave.",
  chunkIndex: 0,
  pageNumber: 1,
  sectionTitle: "Scope",
};

const sourceMap: GenerationSourceMap = new Map([["S1", chunk]]);

function parse(requirements: unknown[]) {
  return modelRequirementsSchema.parse({ requirements });
}

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    title: "Managers approve leave",
    citations: [{ sourceId: "S1", quote: "Managers approve leave." }],
    ...overrides,
  };
}

describe("validateRequirements citation gate", () => {
  it("keeps a requirement whose citation resolves to a real chunk", () => {
    const result = validateRequirements(parse([proposal()]), sourceMap);

    expect(result.requirements).toHaveLength(1);
    expect(result.requirements[0].citations).toEqual([
      {
        sourceId: "S1",
        chunkId: "chunk-1",
        excerpt: "Managers approve leave.",
      },
    ]);
  });

  it("drops an uncited requirement rather than persisting an invented one", () => {
    const result = validateRequirements(
      parse([proposal(), proposal({ title: "Invented scope", citations: [] })]),
      sourceMap,
    );

    expect(result.requirements.map((item) => item.title)).toEqual([
      "Managers approve leave",
    ]);
    expect(result.warnings).toContain("Dropped uncited requirement: Invented scope");
  });

  it("records an unknown label as dropped and discards the requirement", () => {
    const result = validateRequirements(
      parse([
        proposal(),
        proposal({
          title: "Hallucinated label",
          citations: [{ sourceId: "S9", quote: "nothing" }],
        }),
      ]),
      sourceMap,
    );

    expect(result.droppedSourceIds).toContain("S9");
    expect(result.requirements).toHaveLength(1);
  });

  it("never renders a fabricated quote as if it were verbatim", () => {
    const result = validateRequirements(
      parse([
        proposal({
          citations: [{ sourceId: "S1", quote: "Multi-factor authentication required" }],
        }),
      ]),
      sourceMap,
    );

    const excerpt = result.requirements[0].citations[0].excerpt;
    expect(excerpt).not.toBe("Multi-factor authentication required");
    expect(chunk.content.startsWith(excerpt.replace(/…$/, ""))).toBe(true);
  });

  it("throws when nothing survives, so an empty run cannot look successful", () => {
    expect(() =>
      validateRequirements(parse([proposal({ citations: [] })]), sourceMap),
    ).toThrow(PlanValidationError);
  });
});

describe("validateRequirements deduplication", () => {
  it("collapses titles that differ only by case and whitespace", () => {
    const result = validateRequirements(
      parse([
        proposal(),
        proposal({ title: "  managers   APPROVE leave  " }),
      ]),
      sourceMap,
    );

    expect(result.requirements).toHaveLength(1);
    expect(result.warnings.some((w) => w.startsWith("Dropped duplicate"))).toBe(true);
  });
});

describe("modelRequirementsSchema defaults", () => {
  it("under-claims confidence when the model omits it", () => {
    // An omitted confidence means the model did not commit to one; low is the
    // safe direction for a record a human is about to take to the client.
    const parsed = parse([proposal()]);

    expect(parsed.requirements[0].confidence).toBe("low");
  });

  it("defaults classification without inventing detail", () => {
    const parsed = parse([proposal()]);

    expect(parsed.requirements[0]).toMatchObject({
      type: "functional",
      priority: "should",
      acceptanceCriteria: null,
      assumptions: null,
      stakeholder: null,
    });
  });

  it("discards unknown keys the model volunteers", () => {
    const parsed = parse([proposal({ owner: "someone", dueDate: "2026-01-01" })]);

    expect(parsed.requirements[0]).not.toHaveProperty("owner");
    expect(parsed.requirements[0]).not.toHaveProperty("dueDate");
  });
});
