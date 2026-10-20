import { describe, expect, it } from "vitest";
import {
  MAX_TAGS,
  stripSourceLabels,
  validateDocumentLabel,
  type ModelDocumentLabel,
} from "@/lib/documents/label";
import { snippetAround } from "@/lib/documents/snippet";

const base: ModelDocumentLabel = {
  title: "ABC Ltd quotation for server upgrade",
  summary: "A quotation from ABC Ltd for upgrading three servers, valid until 30 November.",
  citations: ["S1"],
  docType: "quotation",
  tags: ["ABC", "server"],
  project: "P1",
};

const ctx = {
  sourceLabels: new Set(["S1", "S2"]),
  projects: new Map([
    ["P1", "project-infra"],
    ["P2", "project-personal"],
  ]),
  currentProjectId: null,
  language: "en" as const,
};

describe("validateDocumentLabel", () => {
  it("keeps a cited summary and resolves the suggested project", () => {
    expect(validateDocumentLabel(base, ctx)).toEqual({
      title: "ABC Ltd quotation for server upgrade",
      summary: base.summary,
      docType: "quotation",
      tags: ["ABC", "server"],
      suggestedProjectId: "project-infra",
    });
  });

  it("drops a summary that cites nothing real", () => {
    expect(validateDocumentLabel({ ...base, citations: [] }, ctx).summary).toBeNull();
    expect(validateDocumentLabel({ ...base, citations: ["S9"] }, ctx).summary).toBeNull();
  });

  it("files an unknown type as other", () => {
    expect(validateDocumentLabel({ ...base, docType: "memo" }, ctx).docType).toBe("other");
  });

  it("cleans, de-duplicates, and caps tags", () => {
    const label = validateDocumentLabel(
      { ...base, tags: ["#ABC", "abc", " Server ", "", "a", "b", "c", "d", "e", "f"] },
      ctx,
    );
    expect(label.tags[0]).toBe("ABC");
    expect(label.tags).toHaveLength(MAX_TAGS);
    expect(label.tags.filter((tag) => tag.toLowerCase() === "abc")).toHaveLength(1);
  });

  it("never invents a project, and does not suggest where the document already is", () => {
    expect(validateDocumentLabel({ ...base, project: "P7" }, ctx).suggestedProjectId).toBeNull();
    expect(
      validateDocumentLabel(base, { ...ctx, currentProjectId: "project-infra" }).suggestedProjectId,
    ).toBeNull();
  });

  it("writes Chinese labels in Traditional characters", () => {
    const label = validateDocumentLabel(
      { ...base, title: "服务器升级报价", summary: "这是报价单。", tags: ["报价"] },
      { ...ctx, language: "zh-Hant" },
    );
    expect(label.title).toBe("服務器升級報價");
    expect(label.summary).toBe("這是報價單。");
    expect(label.tags).toEqual(["報價"]);
  });
});

describe("stripSourceLabels", () => {
  it("removes labels written into the summary, which is shown as plain text", () => {
    expect(stripSourceLabels("根據[S1]，此文件記錄 ABC 公司的報價需求。")).toBe("此文件記錄 ABC 公司的報價需求。");
    expect(stripSourceLabels("報價須包括硬件（S1、S2）及培訓 [S3]。")).toBe("報價須包括硬件及培訓。");
    expect(stripSourceLabels("According to S1, the quote is due on 30 October [S2].")).toBe(
      "the quote is due on 30 October.",
    );
  });

  it("leaves an S-number that is the document's own wording", () => {
    expect(stripSourceLabels("Covers the S1 and S2 server classes.")).toBe(
      "Covers the S1 and S2 server classes.",
    );
  });

  it("is applied to validated summaries", () => {
    const label = validateDocumentLabel({ ...base, summary: "A quotation from ABC Ltd [S1]." }, ctx);
    expect(label.summary).toBe("A quotation from ABC Ltd.");
  });
});

describe("snippetAround", () => {
  it("centres on the first match, case-insensitively, and marks it", () => {
    const text = `${"x".repeat(200)} The Quotation total is HK$12,000 ${"y".repeat(200)}`;
    const snippet = snippetAround(text, "quotation", 20);
    expect(snippet.text.startsWith("…")).toBe(true);
    expect(snippet.text.endsWith("…")).toBe(true);
    const [from, to] = snippet.match!;
    expect(snippet.text.slice(from, to)).toBe("Quotation");
  });

  it("finds Chinese phrases without word boundaries", () => {
    const snippet = snippetAround("本公司就伺服器升級提供報價如下", "報價");
    expect(snippet.text.slice(...snippet.match!)).toBe("報價");
  });

  it("falls back to the opening when the phrase is absent", () => {
    expect(snippetAround("short text", "missing")).toEqual({ text: "short text", match: null });
  });
});
