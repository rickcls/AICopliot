/**
 * Where a project is in requirements discovery, and the one thing to do next.
 *
 * Pure, so the Overview's "Next step" is a tested decision rather than a chain
 * of conditions in JSX. The order is the workflow: documents in, extract,
 * review, resolve questions with the client, agree, then sign off. Earlier
 * steps win — a question for the client does not outrank drafts nobody has
 * read yet, because reading them is what produces the questions.
 */

export interface DiscoveryCounts {
  documents: number;
  readyDocuments: number;
  /** Register rows by status, rejected included. */
  toReview: number;
  askClient: number;
  validated: number;
  agreed: number;
  rejected: number;
}

export type DiscoveryStep =
  | "upload"
  | "wait_indexing"
  | "extract"
  | "review"
  | "clarify"
  | "agree"
  | "sign_off";

export function nextDiscoveryStep(counts: DiscoveryCounts): DiscoveryStep {
  if (counts.documents === 0) return "upload";
  if (counts.readyDocuments === 0) return "wait_indexing";
  const live =
    counts.toReview + counts.askClient + counts.validated + counts.agreed;
  // Nothing extracted yet, or everything extracted was rejected.
  if (live === 0) return "extract";
  if (counts.toReview > 0) return "review";
  if (counts.askClient > 0) return "clarify";
  if (counts.validated > 0) return "agree";
  return "sign_off";
}
