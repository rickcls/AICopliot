import { describe, expect, it } from "vitest";
import {
  csvCell,
  exportFilename,
  requirementsToCsv,
  requirementsToMarkdown,
  type ExportableRequirement,
} from "@/lib/pm/requirements-export";

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
    const csv = requirementsToCsv([requirement()]);
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
    ]);
    const row = csv.split("\r\n")[1];
    expect(row).toContain("REQ-003");
    expect(row).toContain("non functional");
    expect(row).toContain("Delivered");
    expect(row).toContain("Configure IdP [Done]");
  });

  it("does not claim delivery for scope that is not agreed", () => {
    const row = requirementsToCsv([requirement({ status: "draft" })]).split("\r\n")[1];
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
