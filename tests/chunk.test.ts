import { describe, expect, it } from "vitest";
import { chunkSections } from "@/lib/ingest/chunk";
import type { ExtractedSection } from "@/lib/ingest/extract";

/**
 * The chunker is the only place document metadata can be lost, so these tests
 * pin the contract: page numbers and headings survive, indexes stay contiguous
 * and document-global, chunks overlap, and splits respect the size cap.
 */

const paragraph = (word: string, times: number) =>
  Array.from({ length: times }, () => `${word} sentence here.`).join(" ");

describe("chunkSections — metadata preservation", () => {
  it("keeps the page number of the section each chunk came from", () => {
    const sections: ExtractedSection[] = [
      { text: paragraph("alpha", 200), pageNumber: 1, sectionTitle: null },
      { text: paragraph("beta", 200), pageNumber: 2, sectionTitle: null },
    ];

    const chunks = chunkSections(sections, { maxChars: 300, overlapChars: 50 });

    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      const expectedPage = chunk.content.includes("alpha") ? 1 : 2;
      expect(chunk.pageNumber).toBe(expectedPage);
    }
  });

  it("keeps the section title on every chunk of that section", () => {
    const sections: ExtractedSection[] = [
      {
        text: paragraph("escalation", 200),
        pageNumber: null,
        sectionTitle: "Escalation Policy",
      },
    ];

    const chunks = chunkSections(sections, { maxChars: 300, overlapChars: 50 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.sectionTitle === "Escalation Policy")).toBe(true);
  });

  it("preserves null metadata rather than inventing values", () => {
    const chunks = chunkSections([
      { text: "Short plain text.", pageNumber: null, sectionTitle: null },
    ]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].pageNumber).toBeNull();
    expect(chunks[0].sectionTitle).toBeNull();
  });

  it("assigns contiguous, document-global indexes across sections", () => {
    const sections: ExtractedSection[] = [
      { text: paragraph("one", 100), pageNumber: 1, sectionTitle: "A" },
      { text: paragraph("two", 100), pageNumber: 2, sectionTitle: "B" },
      { text: paragraph("three", 100), pageNumber: 3, sectionTitle: "C" },
    ];

    const chunks = chunkSections(sections, { maxChars: 300, overlapChars: 50 });

    // Not restarting at 0 for each section is the point of this assertion.
    expect(chunks.map((c) => c.chunkIndex)).toEqual(
      chunks.map((_, i) => i),
    );
  });
});

describe("chunkSections — splitting behaviour", () => {
  it("never exceeds maxChars", () => {
    const chunks = chunkSections(
      [{ text: paragraph("cap", 400), pageNumber: null, sectionTitle: null }],
      { maxChars: 250, overlapChars: 40 },
    );

    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(250);
    }
  });

  it("overlaps consecutive chunks so context is not cut", () => {
    const chunks = chunkSections(
      [{ text: paragraph("overlap", 200), pageNumber: null, sectionTitle: null }],
      { maxChars: 300, overlapChars: 100 },
    );

    expect(chunks.length).toBeGreaterThan(1);

    // The tail of chunk N should reappear at the head of chunk N+1.
    const tail = chunks[0].content.slice(-40).trim();
    expect(chunks[1].content).toContain(tail.split(" ").slice(-3).join(" "));
  });

  it("splits on whitespace, not mid-word", () => {
    const text = Array.from({ length: 300 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkSections(
      [{ text, pageNumber: null, sectionTitle: null }],
      { maxChars: 200, overlapChars: 30 },
    );

    const allWords = new Set(text.split(" "));
    for (const chunk of chunks) {
      for (const word of chunk.content.split(/\s+/).filter(Boolean)) {
        expect(allWords.has(word)).toBe(true);
      }
    }
  });

  it("returns a single chunk when the text fits", () => {
    const chunks = chunkSections([
      { text: "Restart the service with systemctl restart nginx.", pageNumber: 4, sectionTitle: "Recovery" },
    ]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].pageNumber).toBe(4);
  });

  it("drops empty sections without breaking index continuity", () => {
    const chunks = chunkSections([
      { text: "First.", pageNumber: 1, sectionTitle: null },
      { text: "   ", pageNumber: 2, sectionTitle: null },
      { text: "Third.", pageNumber: 3, sectionTitle: null },
    ]);

    expect(chunks).toHaveLength(2);
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1]);
    expect(chunks.map((c) => c.pageNumber)).toEqual([1, 3]);
  });
});
