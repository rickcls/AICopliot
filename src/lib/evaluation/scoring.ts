/**
 * Deterministic evaluation scoring and aggregate metrics.
 *
 * Scoring is rule-based rather than model-graded on purpose: a regression suite
 * has to give the same verdict for the same output every time, or you cannot
 * tell a retrieval regression from judge variance. Cases that rules cannot
 * decide return `null` and fall to human review instead of being guessed at.
 *
 * Pure and I/O-free so it is directly unit testable.
 */

export interface ScorableCase {
  /** Golden-set expectation: the answer should mention all of these. */
  expectedKeywords: string[];
  /** Golden-set expectation: this question is NOT answerable from the corpus. */
  shouldRefuse: boolean;
}

export interface ScorableOutcome {
  answer: string;
  refused: boolean;
  citationCount: number;
}

/**
 * Returns true (pass), false (fail), or null when there is no machine-checkable
 * expectation and a human must decide.
 */
export function scoreEvaluation(
  expectation: ScorableCase,
  outcome: ScorableOutcome,
): boolean | null {
  if (expectation.shouldRefuse) {
    // The only thing that matters here is that it did not answer anyway.
    return outcome.refused;
  }

  // A refusal on a question we expect to be answerable is always a failure,
  // whatever the keywords say.
  if (outcome.refused) return false;

  if (expectation.expectedKeywords.length > 0) {
    const haystack = outcome.answer.toLowerCase();
    const allPresent = expectation.expectedKeywords.every((keyword) =>
      haystack.includes(keyword.trim().toLowerCase()),
    );
    // An answer with no citation is ungrounded even if the words match.
    return allPresent && outcome.citationCount > 0;
  }

  return null;
}

export function missingKeywords(
  expectedKeywords: string[],
  answer: string,
): string[] {
  const haystack = answer.toLowerCase();
  return expectedKeywords.filter(
    (keyword) => !haystack.includes(keyword.trim().toLowerCase()),
  );
}

// --- Aggregate metrics -----------------------------------------------------

export interface MetricInput {
  shouldRefuse: boolean;
  refused: boolean;
  autoScore: boolean | null;
  result: "pass" | "fail" | "unreviewed";
  citationCount: number;
  latencyMs: number | null;
}

export interface Metrics {
  total: number;
  /** Cases with a machine-checkable expectation. */
  scored: number;
  autoPassRate: number | null;
  /** Of cases expected to refuse, the share that actually refused. */
  refusalAccuracy: number | null;
  refusalCases: number;
  /** Of answerable cases, the share that produced at least one citation. */
  citationRate: number | null;
  humanReviewed: number;
  humanPassRate: number | null;
  medianLatencyMs: number | null;
  p95LatencyMs: number | null;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function computeMetrics(cases: MetricInput[]): Metrics {
  const scored = cases.filter((c) => c.autoScore !== null);
  const refusalCases = cases.filter((c) => c.shouldRefuse);
  const answerable = cases.filter((c) => !c.shouldRefuse);
  const reviewed = cases.filter((c) => c.result !== "unreviewed");

  const latencies = cases
    .map((c) => c.latencyMs)
    .filter((ms): ms is number => typeof ms === "number")
    .sort((a, b) => a - b);

  return {
    total: cases.length,
    scored: scored.length,
    autoPassRate: ratio(
      scored.filter((c) => c.autoScore === true).length,
      scored.length,
    ),
    refusalAccuracy: ratio(
      refusalCases.filter((c) => c.refused).length,
      refusalCases.length,
    ),
    refusalCases: refusalCases.length,
    citationRate: ratio(
      answerable.filter((c) => c.citationCount > 0).length,
      answerable.length,
    ),
    humanReviewed: reviewed.length,
    humanPassRate: ratio(
      reviewed.filter((c) => c.result === "pass").length,
      reviewed.length,
    ),
    medianLatencyMs: latencies.length ? percentile(latencies, 50) : null,
    p95LatencyMs: latencies.length ? percentile(latencies, 95) : null,
  };
}
