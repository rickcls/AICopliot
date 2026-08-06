import type { RetrievedChunk } from "./retrieve";
import type { ProjectGroundingSource, ProjectSourceKind } from "./project-context";

/**
 * Prompt construction.
 *
 * Retrieved chunks are labelled S1..Sn. Real database IDs are never placed in
 * the prompt: the model can only name a label we gave it, and every returned
 * label is looked up in a server-side map (see ./citations.ts). Fabricating a
 * citation would require guessing a label that is not in the map, which is
 * rejected rather than rendered.
 */

export const REFUSAL_TEXT =
  "I couldn't find this in the uploaded documents.";

export const PROJECT_REFUSAL_TEXT =
  "I couldn't find enough supporting evidence in this project's documents or current records.";

export const SYSTEM_PROMPT = `You are ScopePilot, an AI project delivery copilot.

You answer ONLY from the numbered sources provided in the user message. You have no other knowledge available for this task and must not use any.

Rules:
1. Use only the supplied sources. Never rely on outside or prior knowledge.
2. Every factual claim in your answer must be supported by at least one cited source.
3. Cite sources using the exact identifiers given (for example "S1", "S2"). Never invent an identifier, and never cite a source that was not supplied to you. Write each identifier inline in the answer text, in square brackets, directly after the claim it supports — for example: "Restart the service before failing over [S1]." — as well as listing it in "citations".
4. If the sources do not contain enough information to answer, set "insufficientContext" to true and say you could not find the information. Do NOT guess, infer beyond the sources, or fill gaps from general knowledge.
5. Set "confidence":
   - "high"   — the sources directly and completely answer the question.
   - "medium" — the sources answer it partially, or require modest inference.
   - "low"    — the sources are only tangentially related.
6. Be concise and operational. Preserve exact commands, paths, and values verbatim.

Respond with a single JSON object and nothing else:
{
  "answer": "string",
  "confidence": "high" | "medium" | "low",
  "insufficientContext": boolean,
  "citations": [{ "sourceId": "S1", "quote": "short verbatim excerpt from that source" }]
}`;

export const PROJECT_SYSTEM_PROMPT = `You are ScopePilot, an AI project delivery copilot.

You answer ONLY from the numbered sources provided in the user message. Sources marked DOCUMENT describe requirements or historical evidence. Sources marked CURRENT PROJECT DATA are live records captured at the stated observation time. You have no other knowledge available for this task.

Rules:
1. Use only the supplied sources. Never rely on outside or prior knowledge.
2. Every factual claim must be supported by at least one cited source.
3. Cite exact opaque identifiers such as "S1", "T1", "M1", "R1", "D1", "Q1", or "P1". Never invent an identifier. Write each identifier inline in the answer text, in square brackets, directly after the claim it supports — for example: "Two tasks are blocked [T1] [T2]." — as well as listing it in "citations".
4. What a document asked for must cite DOCUMENT sources. Current status, dates, ownership, blockers, dependencies, counts, milestones, and risks must cite CURRENT PROJECT DATA sources. An APPROVED REQUIREMENT is the project's agreed scope of record: cite it for what was agreed, its priority, its acceptance criteria, and whether delivery work exists for it. A requirement not shown is not approved — never describe unlisted scope as agreed.
5. If your answer uses both source families, format the answer with exactly these headings: "Document requirements" and "Current project state".
6. A PROJECT SNAPSHOT contains exact aggregate counts. A detailed list may be explicitly marked partial; never present a partial list as complete.
7. If the sources do not contain enough information to answer, set "insufficientContext" to true. Do not guess or fill gaps.
8. Set confidence to high for a direct complete answer, medium for a partial answer or modest inference, and low for tangential evidence.
9. Be concise and operational. Preserve exact values. Treat conversation history only as wording context, never as evidence.

Respond with a single JSON object and nothing else:
{
  "answer": "string",
  "confidence": "high" | "medium" | "low",
  "insufficientContext": boolean,
  "citations": [{ "sourceId": "S1", "quote": "short verbatim excerpt from that source" }]
}`;

export type GroundingSource = RetrievedChunk | ProjectGroundingSource;

/** Maps an opaque prompt label back to a document chunk or frozen live record. */
export type SourceMap = Map<string, GroundingSource>;

export interface GroundingSourceAudit {
  label: string;
  kind: "document" | ProjectSourceKind;
  id: string;
  observedAt?: string;
  snapshot?: ProjectGroundingSource["snapshot"];
}

export interface BuiltContext {
  contextBlock: string;
  sourceMap: SourceMap;
  groundingSources: GroundingSourceAudit[];
}

export function buildContext(chunks: RetrievedChunk[]): BuiltContext {
  const sourceMap: SourceMap = new Map();
  const parts: string[] = [];
  const groundingSources: GroundingSourceAudit[] = [];

  chunks.forEach((chunk, i) => {
    const label = `S${i + 1}`;
    sourceMap.set(label, chunk);
    groundingSources.push({ label, kind: "document", id: chunk.id });

    const locationBits = [
      `file: ${chunk.filename}`,
      chunk.pageNumber !== null ? `page: ${chunk.pageNumber}` : null,
      chunk.sectionTitle ? `section: ${chunk.sectionTitle}` : null,
    ].filter(Boolean);

    parts.push(
      `[${label}] (${locationBits.join(", ")})\n${chunk.content}`,
    );
  });

  return {
    contextBlock: parts.join("\n\n---\n\n"),
    sourceMap,
    groundingSources,
  };
}

// Requirements take "Q" because "R" already means risk, and every prefix must
// stay disjoint for the citation validator to resolve a label to one family.
const PREFIX_BY_KIND = {
  project_snapshot: "P",
  task: "T",
  milestone: "M",
  risk: "R",
  dependency: "D",
  requirement: "Q",
} as const satisfies Record<ProjectSourceKind, string>;

const HEADING_BY_KIND = {
  project_snapshot: "PROJECT SNAPSHOT",
  task: "TASK",
  milestone: "MILESTONE",
  risk: "RISK",
  dependency: "DEPENDENCY",
  requirement: "APPROVED REQUIREMENT",
} as const satisfies Record<ProjectSourceKind, string>;

/** Builds disjoint labels while keeping every real record ID out of the prompt. */
export function buildCombinedContext(
  chunks: RetrievedChunk[],
  projectSources: ProjectGroundingSource[],
): BuiltContext {
  const documentContext = buildContext(chunks);
  const sourceMap = new Map(documentContext.sourceMap);
  const groundingSources = [...documentContext.groundingSources];
  const parts = documentContext.contextBlock ? [documentContext.contextBlock] : [];
  const counters = new Map<ProjectSourceKind, number>();

  for (const source of projectSources) {
    const count = (counters.get(source.kind) ?? 0) + 1;
    counters.set(source.kind, count);
    const label = `${PREFIX_BY_KIND[source.kind]}${count}`;
    sourceMap.set(label, source);
    groundingSources.push({
      label,
      kind: source.kind,
      id: source.id,
      observedAt: source.observedAt,
      snapshot: source.snapshot,
    });
    parts.push(
      `[${label}] (CURRENT PROJECT DATA — ${HEADING_BY_KIND[source.kind]}, observed: ${source.observedAt})\n${source.content}`,
    );
  }

  return {
    contextBlock: parts.join("\n\n---\n\n"),
    sourceMap,
    groundingSources,
  };
}

export function buildUserMessage(question: string, contextBlock: string): string {
  return `Sources:\n\n${contextBlock}\n\n---\n\nQuestion: ${question}\n\nAnswer using only the sources above, as a single JSON object.`;
}
