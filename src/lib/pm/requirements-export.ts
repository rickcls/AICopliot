import { labelOr, type Translate } from "@/lib/i18n/translate";
import { requirementStatusLabel } from "./labels";
import { formatRequirementCode } from "./rules";
import { deliveryState, type TracedLink } from "./traceability";

/**
 * Requirement register exports.
 *
 * Pure: the route loads the rows, these turn them into text. Delivery state
 * comes from `deliveryState`, the same definition the matrix view renders, so a
 * spreadsheet handed to a client says what the screen says.
 *
 * Every function takes the translator for the file's language, which the
 * caller picks — usually the viewer's, but a pack may go to a client who reads
 * the other one. Text lifted from the client's documents is never translated.
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

/**
 * An enum value's label, or its words when the value is one this build does
 * not know — an export should never print a raw dictionary key.
 */
function enumLabel(t: Translate, family: string, value: string): string {
  return labelOr(t, `${family}.${value}`, words(value));
}

export const typeLabel = (t: Translate, value: string) =>
  enumLabel(t, "requirementType", value);
export const priorityLabel = (t: Translate, value: string) =>
  enumLabel(t, "requirementPriority", value);
const confidenceLabel = (t: Translate, value: string) => enumLabel(t, "confidence", value);

/** Delivery is only claimed for agreed scope — see the matrix view. */
function deliveryLabel(requirement: ExportableRequirement, t: Translate): string {
  return requirement.status === "approved"
    ? t(`deliveryState.${deliveryState(requirement.links)}`)
    : t("requirementsExport.notAgreed");
}

function evidence(requirement: ExportableRequirement, t: Translate): string[] {
  return [
    ...new Set(
      requirement.citations.map(
        (citation) =>
          citation.chunk.document.originalFilename +
          (citation.chunk.pageNumber !== null
            ? ` ${t("requirementsExport.page", { page: citation.chunk.pageNumber })}`
            : ""),
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

const CSV_COLUMNS = [
  "code",
  "title",
  "type",
  "priority",
  "status",
  "confidence",
  "stakeholder",
  "description",
  "acceptanceCriteria",
  "assumptions",
  "source",
  "delivery",
  "tasks",
  "milestones",
  "risks",
  "evidence",
] as const;

/**
 * CRLF line endings and a UTF-8 byte-order mark, because that is what makes
 * Excel on Windows open a CSV with curly quotes, accents, and Chinese intact.
 */
export function requirementsToCsv(
  requirements: ExportableRequirement[],
  t: Translate,
): string {
  const headers = CSV_COLUMNS.map((column) => t(`requirementsExport.headers.${column}`));
  const rows = requirements.map((requirement) => {
    const { tasks, milestones, risks } = linked(requirement);
    return [
      formatRequirementCode(requirement.sequence),
      requirement.title,
      typeLabel(t, requirement.type),
      priorityLabel(t, requirement.priority),
      requirementStatusLabel(requirement.status, t),
      confidenceLabel(t, requirement.confidence),
      requirement.stakeholder,
      requirement.description,
      requirement.acceptanceCriteria,
      requirement.assumptions,
      requirement.source === "manual"
        ? t("requirementsExport.sourceManual")
        : t("requirementsExport.sourceAi"),
      deliveryLabel(requirement, t),
      tasks.join("; "),
      milestones.join("; "),
      risks.join("; "),
      evidence(requirement, t).join("; "),
    ];
  });
  return (
    "﻿" +
    [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") +
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
  t: Translate,
): string {
  const approved = requirements.filter((item) => item.status === "approved");
  const lines = [
    `# ${t("requirementsExport.registerTitle", { project: inline(projectName) })}`,
    "",
    t("requirementsExport.registerSummary", {
      date: exportedAt.toISOString().slice(0, 10),
      count: requirements.length,
      agreed: approved.length,
    }),
    "",
  ];

  for (const requirement of requirements) {
    const { tasks, milestones, risks } = linked(requirement);
    const meta = [
      `**${priorityLabel(t, requirement.priority)}**`,
      typeLabel(t, requirement.type),
      requirementStatusLabel(requirement.status, t),
      t("requirementsExport.confidenceLine", {
        level: confidenceLabel(t, requirement.confidence),
      }),
      ...(requirement.stakeholder
        ? [t("requirementsExport.ownerLine", { name: inline(requirement.stakeholder) })]
        : []),
    ];
    lines.push(
      `## ${formatRequirementCode(requirement.sequence)} ${inline(requirement.title)}`,
      "",
      meta.join(" · "),
      "",
    );
    if (requirement.description) lines.push(requirement.description.trim(), "");
    if (requirement.acceptanceCriteria) {
      lines.push(
        `**${t("requirementsExport.headers.acceptanceCriteria")}**`,
        "",
        requirement.acceptanceCriteria.trim(),
        "",
      );
    }
    if (requirement.assumptions) {
      lines.push(
        `**${t("requirementsExport.headers.assumptions")}**`,
        "",
        requirement.assumptions.trim(),
        "",
      );
    }
    lines.push(
      `**${t("requirementsExport.deliveryLabel")}** ${deliveryLabel(requirement, t)}`,
      "",
    );
    for (const [column, items] of [
      ["tasks", tasks],
      ["milestones", milestones],
      ["risks", risks],
      ["evidence", evidence(requirement, t)],
    ] as const) {
      if (items.length === 0) continue;
      lines.push(
        `**${t(`requirementsExport.headers.${column}`)}**`,
        "",
        ...items.map((item) => `- ${inline(item)}`),
        "",
      );
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

export interface PackItem {
  code: string;
  title: string;
  description: string | null;
  /** The stored MoSCoW value, for styling. */
  priority: string;
  priorityLabel: string;
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

function packItem(
  requirement: ExportableRequirement,
  question: string | null,
  t: Translate,
): PackItem {
  return {
    code: formatRequirementCode(requirement.sequence),
    title: requirement.title,
    description: requirement.description,
    priority: requirement.priority,
    priorityLabel: priorityLabel(t, requirement.priority),
    type: typeLabel(t, requirement.type),
    acceptanceCriteria: requirement.acceptanceCriteria,
    question,
    evidence: evidence(requirement, t),
  };
}

/**
 * Why the client is being asked. Recorded assumptions are the concrete open
 * point; without them, the status or a low extraction confidence says what
 * kind of answer is needed. Never invents a specific — the same rule the
 * extraction prompt follows.
 */
function questionFor(requirement: ExportableRequirement, t: Translate): string {
  if (requirement.assumptions) return requirement.assumptions.trim();
  if (requirement.status === "needs_clarification") {
    return t("requirementsPack.questionConfirm");
  }
  return t("requirementsPack.questionSpecifics");
}

/**
 * Items marked Ask client, plus undecided items extracted at low confidence —
 * the vague ones that will otherwise surface as a dispute later. Agreed and
 * rejected rows are settled, so they never appear. Grouped by stakeholder, so
 * each person gets the questions that are theirs.
 */
export function questionsPack(rows: ExportableRequirement[], t: Translate): PackGroup[] {
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
    items.push(packItem(row, questionFor(row, t), t));
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
export function signOffPack(rows: ExportableRequirement[], t: Translate): PackGroup[] {
  const agreed = rows
    .filter((row) => row.status === "approved")
    .sort(byPriorityThenSequence)
    .map((row) => packItem(row, null, t));
  return agreed.length === 0 ? [] : [{ heading: null, items: agreed }];
}

export function buildPack(kind: PackKind, rows: ExportableRequirement[], t: Translate) {
  return kind === "questions" ? questionsPack(rows, t) : signOffPack(rows, t);
}

export function packToMarkdown(
  kind: PackKind,
  projectName: string,
  groups: PackGroup[],
  exportedAt: Date,
  t: Translate,
): string {
  const count = groups.reduce((total, group) => total + group.items.length, 0);
  const lines = [
    `# ${inline(projectName)} — ${t(`requirementsPack.title.${kind}`)}`,
    "",
    t("requirementsPack.summary", { date: exportedAt.toISOString().slice(0, 10), count }),
    "",
    kind === "questions"
      ? t("requirementsPack.questionsIntro")
      : t("requirementsPack.signoffIntro"),
    "",
  ];

  for (const group of groups) {
    if (group.heading) {
      lines.push(`## ${t("requirementsPack.forStakeholder", { name: inline(group.heading) })}`, "");
    }
    for (const item of group.items) {
      lines.push(
        `### ${item.code} ${inline(item.title)}`,
        "",
        `${item.priorityLabel} · ${item.type}`,
        "",
      );
      if (item.description) lines.push(item.description.trim(), "");
      if (item.question) {
        lines.push(`**${t("requirementsPack.toConfirm")}** ${inline(item.question)}`, "");
      }
      if (item.acceptanceCriteria) {
        lines.push(
          `**${t("requirementsPack.acceptance")}** ${inline(item.acceptanceCriteria)}`,
          "",
        );
      }
      if (item.evidence.length > 0) {
        lines.push(
          `_${t("requirementsPack.source", { sources: item.evidence.map(inline).join("; ") })}_`,
          "",
        );
      }
    }
  }

  if (kind === "signoff") {
    const blank = "______________________________";
    lines.push(
      "---",
      "",
      `${t("requirementsPack.approvedBy")}: ${blank}`,
      "",
      `${t("requirementsPack.role")}: ${blank}`,
      "",
      `${t("requirementsPack.date")}: ${blank}`,
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
