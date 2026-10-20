import { describe, expect, it } from "vitest";
import { translatorFor } from "@/lib/i18n/dictionaries";
import {
  buildPack,
  csvCell,
  exportFilename,
  packToMarkdown,
  parsePackKind,
  questionsPack,
  signOffPack,
  requirementsToCsv,
  requirementsToMarkdown,
  type ExportableRequirement,
} from "@/lib/pm/requirements-export";

const en = translatorFor("en");
const zh = translatorFor("zh-Hant");

function requirement(
  overrides: Partial<ExportableRequirement> = {},
): ExportableRequirement {
  return {
    sequence: 3,
    title: "Single sign-on",
    description: "Staff log in with corporate credentials.",
    type: "non_functional",
    priority: "must",
    status: "approved",
    confidence: "high",
    stakeholder: "IT Security",
    acceptanceCriteria: null,
    assumptions: null,
    source: "ai_suggested",
    links: [],
    citations: [],
    ...overrides,
  };
}

describe("csvCell", () => {
  it("leaves plain text alone", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(null)).toBe("");
  });

  it("quotes delimiters, quotes, and line breaks", () => {
    expect(csvCell('a, "b"\nc')).toBe('"a, ""b""\nc"');
  });

  it("neutralises cells a spreadsheet would run as a formula", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });
});

describe("requirementsToCsv", () => {
  it("starts with a BOM and a header row, and uses CRLF", () => {
    const csv = requirementsToCsv([requirement()], en);
    expect(csv.startsWith("﻿Code,Title,")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(3);
  });

  it("writes the rendered code, readable enums, and delivery state", () => {
    const csv = requirementsToCsv([
      requirement({
        links: [
          {
            targetType: "task",
            task: { title: "Configure IdP", status: { category: "done", label: "Done" } },
            milestone: null,
            risk: null,
          },
        ],
      }),
    ], en);
    const row = csv.split("\r\n")[1];
    expect(row).toContain("REQ-003");
    expect(row).toContain("Non-functional");
    expect(row).toContain("Delivered");
    expect(row).toContain("Configure IdP [Done]");
  });

  it("does not claim delivery for scope that is not agreed", () => {
    const row = requirementsToCsv([requirement({ status: "draft" })], en).split("\r\n")[1];
    expect(row).toContain("Not agreed");
    expect(row).not.toContain("No task");
  });
});

describe("requirementsToMarkdown", () => {
  it("renders a heading per requirement with linked records and evidence", () => {
    const markdown = requirementsToMarkdown(
      "Acme Portal",
      [
        requirement({
          acceptanceCriteria: "Login via Azure AD succeeds.",
          citations: [
            { chunk: { pageNumber: 4, document: { originalFilename: "sow.pdf" } } },
            { chunk: { pageNumber: 4, document: { originalFilename: "sow.pdf" } } },
          ],
        }),
      ],
      new Date("2026-09-24T10:00:00Z"),
      en,
    );
    expect(markdown).toContain("# Acme Portal — Requirements");
    expect(markdown).toContain("Exported 2026-09-24 · 1 requirement · 1 agreed");
    expect(markdown).toContain("## REQ-003 Single sign-on");
    expect(markdown).toContain("**Delivery:** No task");
    // Duplicate citations of one page collapse to one evidence line.
    expect(markdown.match(/- sow\.pdf p\.4/g)).toHaveLength(1);
  });

  it("keeps a multi-line title on its heading line", () => {
    const markdown = requirementsToMarkdown(
      "P",
      [requirement({ title: "Line one\n# not a heading" })],
      new Date(),
      en,
    );
    expect(markdown).toContain("## REQ-003 Line one # not a heading");
  });
});

describe("exportFilename", () => {
  it("slugs the project name and falls back when nothing survives", () => {
    expect(exportFilename("Acme Portal (Phase 2)", "csv")).toBe(
      "acme-portal-phase-2-requirements.csv",
    );
    expect(exportFilename("???", "md")).toBe("project-requirements.md");
  });
});

describe("questionsPack", () => {
  it("collects Ask client items and undecided low-confidence ones only", () => {
    const groups = questionsPack([
      requirement({ sequence: 1, status: "needs_clarification", stakeholder: null }),
      requirement({ sequence: 2, status: "draft", confidence: "low", stakeholder: null }),
      requirement({ sequence: 3, status: "draft", confidence: "high", stakeholder: null }),
      requirement({ sequence: 4, status: "approved", confidence: "low", stakeholder: null }),
      requirement({ sequence: 5, status: "rejected", confidence: "low", stakeholder: null }),
    ], en);
    expect(groups.flatMap((group) => group.items.map((item) => item.code))).toEqual([
      "REQ-001",
      "REQ-002",
    ]);
  });

  it("asks the recorded assumption rather than inventing a question", () => {
    const [group] = questionsPack([
      requirement({
        status: "needs_clarification",
        assumptions: "Which identity provider — Azure AD or Okta?",
      }),
    ], en);
    expect(group.items[0].question).toBe("Which identity provider — Azure AD or Okta?");
  });

  it("groups by stakeholder, named first and unassigned last", () => {
    const groups = questionsPack([
      requirement({ sequence: 1, status: "needs_clarification", stakeholder: null }),
      requirement({ sequence: 2, status: "needs_clarification", stakeholder: "Operations" }),
      requirement({ sequence: 3, status: "needs_clarification", stakeholder: "Finance" }),
    ], en);
    expect(groups.map((group) => group.heading)).toEqual(["Finance", "Operations", null]);
  });
});

describe("signOffPack", () => {
  it("includes agreed scope only, Must first", () => {
    const [group] = signOffPack([
      requirement({ sequence: 1, status: "approved", priority: "could" }),
      requirement({ sequence: 2, status: "validated", priority: "must" }),
      requirement({ sequence: 3, status: "approved", priority: "must" }),
    ], en);
    expect(group.items.map((item) => item.code)).toEqual(["REQ-003", "REQ-001"]);
    expect(group.items[0].question).toBeNull();
  });

  it("is empty when nothing is agreed", () => {
    expect(signOffPack([requirement({ status: "draft" })], en)).toEqual([]);
  });
});

describe("packToMarkdown", () => {
  it("renders the question under each item", () => {
    const markdown = packToMarkdown(
      "questions",
      "Acme",
      buildPack("questions", [
        requirement({ status: "needs_clarification", assumptions: "Retention period?" }),
      ], en),
      new Date("2026-09-24T00:00:00Z"),
      en,
    );
    expect(markdown).toContain("# Acme — Open questions");
    expect(markdown).toContain("**To confirm:** Retention period?");
    expect(markdown).not.toContain("Approved by:");
  });

  it("ends a sign-off document with a signature block", () => {
    const markdown = packToMarkdown(
      "signoff",
      "Acme",
      buildPack("signoff", [requirement()], en),
      new Date("2026-09-24T00:00:00Z"),
      en,
    );
    expect(markdown).toContain("# Acme — Requirements for sign-off");
    expect(markdown).toContain("Approved by:");
  });
});

describe("parsePackKind", () => {
  it("accepts only the two packs", () => {
    expect(parsePackKind("questions")).toBe("questions");
    expect(parsePackKind("signoff")).toBe("signoff");
    expect(parsePackKind("all")).toBeNull();
    expect(parsePackKind(["questions"])).toBeNull();
  });

  it("names pack downloads distinctly", () => {
    expect(exportFilename("Acme", "md", "sign-off")).toBe("acme-sign-off.md");
  });
});

describe("exports in Chinese", () => {
  it("translates headers and labels but never the client's own words", () => {
    const csv = requirementsToCsv([requirement({ status: "needs_clarification" })], zh);
    const [header, row] = csv.split("\r\n");
    expect(header).toBe(
      "﻿編號,標題,類別,優先度,狀態,信心,持份者,描述,驗收準則,假設,來源,交付,工作,里程碑,風險,出處",
    );
    expect(row).toContain("非功能");
    expect(row).toContain("必須有");
    expect(row).toContain("要問客戶");
    expect(row).toContain("未議定");
    // Lifted from the client's document, so it stays as written.
    expect(row).toContain("Single sign-on");
    expect(row).toContain("IT Security");
  });

  it("writes the pack's frame in the pack's language", () => {
    const markdown = packToMarkdown(
      "signoff",
      "Acme",
      buildPack("signoff", [requirement()], zh),
      new Date("2026-09-24T00:00:00Z"),
      zh,
    );
    expect(markdown).toContain("# Acme — 待簽署需求");
    expect(markdown).toContain("2026-09-24 · 1 項");
    expect(markdown).toContain("必須有 · 非功能");
    expect(markdown).toContain("批核人: ");
  });

  it("falls back to readable words for a value the dictionary does not know", () => {
    const row = requirementsToCsv([requirement({ type: "legal_hold" })], zh).split("\r\n")[1];
    expect(row).toContain("legal hold");
    expect(row).not.toContain("requirementType.");
  });
});
