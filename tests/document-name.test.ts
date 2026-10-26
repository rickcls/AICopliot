import { describe, expect, it } from "vitest";
import { documentName } from "@/lib/documents/name";

/** One rule for what a document is called, so every screen agrees. */
describe("documentName", () => {
  it("uses the name a person gave the document", () => {
    expect(documentName({ title: "ABC 報價（最終版）", originalFilename: "quote_v3_final.pdf" })).toBe(
      "ABC 報價（最終版）",
    );
  });

  it("falls back to the file's own name when there is none, or only spaces", () => {
    expect(documentName({ title: null, originalFilename: "brief.pdf" })).toBe("brief.pdf");
    expect(documentName({ title: "  ", originalFilename: "brief.pdf" })).toBe("brief.pdf");
    expect(documentName({ originalFilename: "brief.pdf" })).toBe("brief.pdf");
  });
});
