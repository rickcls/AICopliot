import { describe, expect, it } from "vitest";
import {
  computeMetrics,
  missingKeywords,
  scoreEvaluation,
  type MetricInput,
} from "@/lib/evaluation/scoring";

/**
 * Deterministic scoring. A regression suite is only useful if the same output
 * always yields the same verdict, so these pin the rules — including the cases
 * that deliberately defer to a human rather than guessing.
 */

const answered = {
  answer: "Run `repmgr standby promote` after checking pg_isready.",
  refused: false,
  citationCount: 1,
};

const refusedOutcome = {
  answer: "I couldn't find this in the uploaded documents.",
  refused: true,
  citationCount: 0,
};

describe("scoreEvaluation — refusal expectations", () => {
  it("passes when a should-refuse case refuses", () => {
    expect(
      scoreEvaluation({ expectedKeywords: [], shouldRefuse: true }, refusedOutcome),
    ).toBe(true);
  });

  it("fails when a should-refuse case answers anyway", () => {
    // This is the hallucination case; it must never score as a pass.
    expect(
      scoreEvaluation({ expectedKeywords: [], shouldRefuse: true }, answered),
    ).toBe(false);
  });

  it("ignores keywords entirely for should-refuse cases", () => {
    expect(
      scoreEvaluation(
        { expectedKeywords: ["repmgr"], shouldRefuse: true },
        refusedOutcome,
      ),
    ).toBe(true);
  });
});

describe("scoreEvaluation — keyword expectations", () => {
  it("passes when every keyword appears and the answer is cited", () => {
    expect(
      scoreEvaluation(
        { expectedKeywords: ["repmgr", "pg_isready"], shouldRefuse: false },
        answered,
      ),
    ).toBe(true);
  });

  it("fails when any keyword is missing", () => {
    expect(
      scoreEvaluation(
        { expectedKeywords: ["repmgr", "wal_level"], shouldRefuse: false },
        answered,
      ),
    ).toBe(false);
  });

  it("matches case-insensitively and tolerates padding", () => {
    expect(
      scoreEvaluation(
        { expectedKeywords: ["  REPMGR  "], shouldRefuse: false },
        answered,
      ),
    ).toBe(true);
  });

  it("fails a keyword-matching answer that has no citation", () => {
    // Right words, no evidence — ungrounded, so not a pass.
    expect(
      scoreEvaluation(
        { expectedKeywords: ["repmgr"], shouldRefuse: false },
        { ...answered, citationCount: 0 },
      ),
    ).toBe(false);
  });

  it("fails when an answerable case refuses", () => {
    expect(
      scoreEvaluation(
        { expectedKeywords: ["repmgr"], shouldRefuse: false },
        refusedOutcome,
      ),
    ).toBe(false);
  });
});

describe("scoreEvaluation — deferring to human review", () => {
  it("returns null when there is no machine-checkable expectation", () => {
    expect(
      scoreEvaluation({ expectedKeywords: [], shouldRefuse: false }, answered),
    ).toBeNull();
  });

  it("still fails an unexpected refusal even with no keywords", () => {
    expect(
      scoreEvaluation({ expectedKeywords: [], shouldRefuse: false }, refusedOutcome),
    ).toBe(false);
  });
});

describe("missingKeywords", () => {
  it("lists only the absent keywords", () => {
    expect(
      missingKeywords(["repmgr", "wal_level", "pg_isready"], answered.answer),
    ).toEqual(["wal_level"]);
  });

  it("returns empty when all are present", () => {
    expect(missingKeywords(["repmgr"], answered.answer)).toEqual([]);
  });
});

describe("computeMetrics", () => {
  const cases: MetricInput[] = [
    { shouldRefuse: false, refused: false, autoScore: true, result: "pass", citationCount: 2, latencyMs: 1000 },
    { shouldRefuse: false, refused: false, autoScore: false, result: "fail", citationCount: 1, latencyMs: 2000 },
    { shouldRefuse: true, refused: true, autoScore: true, result: "pass", citationCount: 0, latencyMs: 500 },
    { shouldRefuse: true, refused: false, autoScore: false, result: "fail", citationCount: 3, latencyMs: 3000 },
    { shouldRefuse: false, refused: false, autoScore: null, result: "unreviewed", citationCount: 0, latencyMs: 1500 },
  ];

  it("counts totals and auto-scored cases", () => {
    const m = computeMetrics(cases);
    expect(m.total).toBe(5);
    expect(m.scored).toBe(4); // the null-scored case is excluded
  });

  it("computes auto pass rate over scored cases only", () => {
    expect(computeMetrics(cases).autoPassRate).toBe(0.5); // 2 of 4
  });

  it("computes refusal accuracy over should-refuse cases only", () => {
    const m = computeMetrics(cases);
    expect(m.refusalCases).toBe(2);
    expect(m.refusalAccuracy).toBe(0.5); // 1 of 2 actually refused
  });

  it("computes citation rate over answerable cases only", () => {
    // 3 answerable; 2 have citations.
    expect(computeMetrics(cases).citationRate).toBeCloseTo(2 / 3);
  });

  it("computes human pass rate over reviewed cases only", () => {
    const m = computeMetrics(cases);
    expect(m.humanReviewed).toBe(4);
    expect(m.humanPassRate).toBe(0.5);
  });

  it("reports latency percentiles", () => {
    const m = computeMetrics(cases);
    expect(m.medianLatencyMs).toBe(1500);
    expect(m.p95LatencyMs).toBe(3000);
  });

  it("returns nulls rather than NaN for an empty suite", () => {
    const m = computeMetrics([]);
    expect(m.total).toBe(0);
    expect(m.autoPassRate).toBeNull();
    expect(m.refusalAccuracy).toBeNull();
    expect(m.citationRate).toBeNull();
    expect(m.medianLatencyMs).toBeNull();
  });

  it("returns null refusal accuracy when no case expects a refusal", () => {
    const m = computeMetrics([
      { shouldRefuse: false, refused: false, autoScore: true, result: "pass", citationCount: 1, latencyMs: 100 },
    ]);
    expect(m.refusalAccuracy).toBeNull();
  });
});
