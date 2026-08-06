import { describe, expect, it } from "vitest";
import { parseStoredCitations } from "@/lib/chat/stored-citations";

/**
 * Replaying a thread re-validates audit data written against an older shape of
 * the schema, so this is where backward compatibility is actually pinned.
 */

const documentRow = {
  kind: "document",
  chunkId: "chunk-1",
  documentId: "doc-1",
  filename: "runbook.md",
  pageNumber: 3,
  sectionTitle: "Escalation",
  excerpt: "Page the on-call.",
  score: 0.82,
  matchType: "semantic",
};

describe("parseStoredCitations", () => {
  it("parses a row written before citations carried a label", () => {
    const result = parseStoredCitations([documentRow]);

    expect(result.unavailable).toBe(false);
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].label).toBeUndefined();
  });

  it("keeps the label when one was stored", () => {
    const result = parseStoredCitations([{ ...documentRow, label: "S1" }]);

    expect(result.citations[0].label).toBe("S1");
  });

  it("treats an absent blob as no citations rather than as a loss", () => {
    expect(parseStoredCitations(null)).toEqual({ citations: [], unavailable: false });
    expect(parseStoredCitations(undefined)).toEqual({
      citations: [],
      unavailable: false,
    });
  });

  it("reports an unparseable blob instead of throwing", () => {
    // One stale row must not 500 the whole conversation.
    const result = parseStoredCitations([{ kind: "document", chunkId: 42 }]);

    expect(result).toEqual({ citations: [], unavailable: true });
  });

  it("rejects the whole array when one entry has an unknown kind", () => {
    const result = parseStoredCitations([documentRow, { kind: "invoice" }]);

    expect(result.unavailable).toBe(true);
    expect(result.citations).toEqual([]);
  });

  it("parses a stored live-record citation", () => {
    const result = parseStoredCitations([
      {
        kind: "requirement",
        label: "Q1",
        title: "REQ-007 Single sign-on",
        excerpt: "Users authenticate through the corporate IdP.",
        observedAt: "2026-08-06T00:00:00.000Z",
        href: "/projects/p1/requirements",
        snapshot: { priority: "must", covered: false },
      },
    ]);

    expect(result.unavailable).toBe(false);
    expect(result.citations[0]).toMatchObject({ kind: "requirement", label: "Q1" });
  });
});
