import { requirementStatusLabel } from "./labels";
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
      requirementStatusLabel(requirement.status),
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
    `Exported ${exportedAt.toISOString().slice(0, 10)} · ${requirements.length} requirement${requirements.length === 1 ? "" : "s"} · ${approved.length} agreed`,
    "",
  ];

  for (const requirement of requirements) {
    const { tasks, milestones, risks } = linked(requirement);
    lines.push(
      `## ${formatRequirementCode(requirement.sequence)} ${inline(requirement.title)}`,
      "",
      `**${requirement.priority.toUpperCase()}** · ${words(requirement.type)} · ${requirementStatusLabel(requirement.status)} · confidence ${requirement.confidence}` +
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

// --- Client packs ----------------------------------------------------------
//
// The two documents a consultant actually sends: the open questions to take
// back to the client, and the agreed scope to sign. Each pack is built once as
// data and rendered twice — Markdown here, HTML on the print page — so the PDF
// and the download can never say different things.

export type PackKind = "questions" | "signoff";

export function parsePackKind(value: unknown): PackKind | null {
  return value === "questions" || value === "signoff" ? value : null;
}

export const PACK_TITLE: Record<PackKind, string> = {
  questions: "Open questions",
  signoff: "Requirements for sign-off",
};

export interface PackItem {
  code: string;
  title: string;
  description: string | null;
  priority: string;
  type: string;
  acceptanceCriteria: string | null;
  /** What the client needs to answer. Questions pack only. */
  question: string | null;
  evidence: string[];
}

export interface PackGroup {
  /** Stakeholder heading; null collects the rest. */
  heading: string | null;
  items: PackItem[];
}

const PRIORITY_ORDER: Record<string, number> = { must: 0, should: 1, could: 2, wont: 3 };

function byPriorityThenSequence(a: ExportableRequirement, b: ExportableRequirement) {
  return (
    (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) ||
    a.sequence - b.sequence
  );
}

function packItem(requirement: ExportableRequirement, question: string | null): PackItem {
  return {
    code: formatRequirementCode(requirement.sequence),
    title: requirement.title,
    description: requirement.description,
    priority: requirement.priority,
    type: words(requirement.type),
    acceptanceCriteria: requirement.acceptanceCriteria,
    question,
    evidence: evidence(requirement),
  };
}

/**
 * Why the client is being asked. Recorded assumptions are the concrete open
 * point; without them, the status or a low extraction confidence says what
 * kind of answer is needed. Never invents a specific — the same rule the
 * extraction prompt follows.
 */
function questionFor(requirement: ExportableRequirement): string {
  if (requirement.assumptions) return requirement.assumptions.trim();
  if (requirement.status === "needs_clarification") {
    return "Please confirm this requirement and the detail it needs.";
  }
  return "The source states this only in general terms. Please confirm the specifics you expect.";
}

/**
 * Items marked Ask client, plus undecided items extracted at low confidence —
 * the vague ones that will otherwise surface as a dispute later. Agreed and
 * rejected rows are settled, so they never appear. Grouped by stakeholder, so
 * each person gets the questions that are theirs.
 */
export function questionsPack(rows: ExportableRequirement[]): PackGroup[] {
  const open = rows
    .filter(
      (row) =>
        row.status === "needs_clarification" ||
        (row.confidence === "low" &&
          (row.status === "draft" || row.status === "validated")),
    )
    .sort(byPriorityThenSequence);

  const groups = new Map<string | null, PackItem[]>();
  for (const row of open) {
    const heading = row.stakeholder?.trim() || null;
    const items = groups.get(heading) ?? [];
    items.push(packItem(row, questionFor(row)));
    groups.set(heading, items);
  }
  // Named stakeholders first, alphabetically; the unassigned group last.
  return [...groups.entries()]
    .sort(([a], [b]) =>
      a === null ? 1 : b === null ? -1 : a.localeCompare(b),
    )
    .map(([heading, items]) => ({ heading, items }));
}

/** Agreed scope only, Must first — the order a client reads a contract in. */
export function signOffPack(rows: ExportableRequirement[]): PackGroup[] {
  const agreed = rows
    .filter((row) => row.status === "approved")
    .sort(byPriorityThenSequence)
    .map((row) => packItem(row, null));
  return agreed.length === 0 ? [] : [{ heading: null, items: agreed }];
}

export function buildPack(kind: PackKind, rows: ExportableRequirement[]) {
  return kind === "questions" ? questionsPack(rows) : signOffPack(rows);
}

export function packToMarkdown(
  kind: PackKind,
  projectName: string,
  groups: PackGroup[],
  exportedAt: Date,
): string {
  const count = groups.reduce((total, group) => total + group.items.length, 0);
  const lines = [
    `# ${inline(projectName)} — ${PACK_TITLE[kind]}`,
    "",
    `${exportedAt.toISOString().slice(0, 10)} · ${count} item${count === 1 ? "" : "s"}`,
    "",
    kind === "questions"
      ? "Each item below is something we understood from your documents but could not confirm. Please answer the point under each one."
      : "The requirements below are the agreed scope. Please review and sign below to confirm.",
    "",
  ];

  for (const group of groups) {
    if (group.heading) lines.push(`## For ${inline(group.heading)}`, "");
    for (const item of group.items) {
      lines.push(
        `### ${item.code} ${inline(item.title)}`,
        "",
        `${item.priority.toUpperCase()} · ${item.type}`,
        "",
      );
      if (item.description) lines.push(item.description.trim(), "");
      if (item.question) lines.push(`**To confirm:** ${inline(item.question)}`, "");
      if (item.acceptanceCriteria) {
        lines.push(`**Acceptance:** ${inline(item.acceptanceCriteria)}`, "");
      }
      if (item.evidence.length > 0) {
        lines.push(`_Source: ${item.evidence.map(inline).join("; ")}_`, "");
      }
    }
  }

  if (kind === "signoff") {
    lines.push(
      "---",
      "",
      "Approved by: ______________________________",
      "",
      "Role: ______________________________",
      "",
      "Date: ______________________________",
      "",
    );
  }
  return lines.join("\n");
}

/** A filename-safe slug; falls back so an all-symbol name still downloads. */
export function exportFilename(
  projectName: string,
  extension: "csv" | "md",
  suffix = "requirements",
): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "project"}-${suffix}.${extension}`;
}
