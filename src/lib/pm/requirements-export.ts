import { formatRequirementCode } from "./rules";
import {
  deliveryState,
  DELIVERY_STATE_LABEL,
  type TracedLink,
} from "./traceability";

/**
 * Requirement register exports.
 *
 * Pure: the route loads the rows, these turn them into text. Delivery state
 * comes from `deliveryState`, the same definition the matrix view renders, so a
 * spreadsheet handed to a client says what the screen says.
 */

export interface ExportableRequirement {
  sequence: number;
  title: string;
  description: string | null;
  type: string;
  priority: string;
  status: string;
  confidence: string;
  stakeholder: string | null;
  acceptanceCriteria: string | null;
  assumptions: string | null;
  source: string;
  links: Array<
    TracedLink & {
      task: { title: string; status: { category: string; label: string } } | null;
      milestone: { title: string } | null;
      risk: { description: string } | null;
    }
  >;
  citations: Array<{
    chunk: {
      pageNumber: number | null;
      document: { originalFilename: string };
    };
  }>;
}

function words(value: string) {
  return value.replaceAll("_", " ");
}

/** Delivery is only claimed for agreed scope — see the matrix view. */
function deliveryLabel(requirement: ExportableRequirement): string {
  return requirement.status === "approved"
    ? DELIVERY_STATE_LABEL[deliveryState(requirement.links)]
    : "Not agreed";
}

function evidence(requirement: ExportableRequirement): string[] {
  return [
    ...new Set(
      requirement.citations.map(
        (citation) =>
          citation.chunk.document.originalFilename +
          (citation.chunk.pageNumber !== null ? ` p.${citation.chunk.pageNumber}` : ""),
      ),
    ),
  ];
}

function linked(requirement: ExportableRequirement) {
  return {
    tasks: requirement.links.flatMap((link) =>
      link.task ? [`${link.task.title} [${link.task.status.label}]`] : [],
    ),
    milestones: requirement.links.flatMap((link) =>
      link.milestone ? [link.milestone.title] : [],
    ),
    risks: requirement.links.flatMap((link) =>
      link.risk ? [link.risk.description] : [],
    ),
  };
}

/**
 * One CSV cell. Quoted when it contains a delimiter, quote, or line break.
 *
 * A cell beginning with `=`, `+`, `-`, `@`, tab, or carriage return is run as a
 * formula by Excel and Sheets, and these cells hold text extracted from client
 * documents. Prefixing a single quote makes the spreadsheet show it as text.
 */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export const REQUIREMENT_CSV_HEADERS = [
  "Code",
  "Title",
  "Type",
  "Priority",
  "Status",
  "Confidence",
  "Stakeholder",
  "Description",
  "Acceptance criteria",
  "Assumptions",
  "Source",
  "Delivery",
  "Tasks",
  "Milestones",
  "Risks",
  "Evidence",
] as const;

/**
 * CRLF line endings and a UTF-8 byte-order mark, because that is what makes
 * Excel on Windows open a CSV with curly quotes and accents intact.
 */
export function requirementsToCsv(requirements: ExportableRequirement[]): string {
  const rows = requirements.map((requirement) => {
    const { tasks, milestones, risks } = linked(requirement);
    return [
      formatRequirementCode(requirement.sequence),
      requirement.title,
      words(requirement.type),
      requirement.priority,
      words(requirement.status),
      requirement.confidence,
      requirement.stakeholder,
      requirement.description,
      requirement.acceptanceCriteria,
      requirement.assumptions,
      requirement.source === "manual" ? "manual" : "AI suggested",
      deliveryLabel(requirement),
      tasks.join("; "),
      milestones.join("; "),
      risks.join("; "),
      evidence(requirement).join("; "),
    ];
  });
  return (
    "﻿" +
    [REQUIREMENT_CSV_HEADERS, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n") +
    "\r\n"
  );
}

/** Collapses line breaks so a value cannot start a new Markdown block. */
function inline(value: string): string {
  return value.replace(/\s*\n+\s*/g, " ").trim();
}

export function requirementsToMarkdown(
  projectName: string,
  requirements: ExportableRequirement[],
  exportedAt: Date,
): string {
  const approved = requirements.filter((item) => item.status === "approved");
  const lines = [
    `# ${inline(projectName)} — Requirements`,
    "",
    `Exported ${exportedAt.toISOString().slice(0, 10)} · ${requirements.length} requirement${requirements.length === 1 ? "" : "s"} · ${approved.length} approved`,
    "",
  ];

  for (const requirement of requirements) {
    const { tasks, milestones, risks } = linked(requirement);
    lines.push(
      `## ${formatRequirementCode(requirement.sequence)} ${inline(requirement.title)}`,
      "",
      `**${requirement.priority.toUpperCase()}** · ${words(requirement.type)} · ${words(requirement.status)} · confidence ${requirement.confidence}` +
        (requirement.stakeholder ? ` · owner ${inline(requirement.stakeholder)}` : ""),
      "",
    );
    if (requirement.description) lines.push(requirement.description.trim(), "");
    if (requirement.acceptanceCriteria) {
      lines.push("**Acceptance criteria**", "", requirement.acceptanceCriteria.trim(), "");
    }
    if (requirement.assumptions) {
      lines.push("**Assumptions**", "", requirement.assumptions.trim(), "");
    }
    lines.push(`**Delivery:** ${deliveryLabel(requirement)}`, "");
    for (const [label, items] of [
      ["Tasks", tasks],
      ["Milestones", milestones],
      ["Risks", risks],
      ["Evidence", evidence(requirement)],
    ] as const) {
      if (items.length === 0) continue;
      lines.push(`**${label}**`, "", ...items.map((item) => `- ${inline(item)}`), "");
    }
  }

  return lines.join("\n");
}

/** A filename-safe slug; falls back so an all-symbol name still downloads. */
export function exportFilename(projectName: string, extension: "csv" | "md"): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "project"}-requirements.${extension}`;
}
