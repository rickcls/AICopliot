import type { ModelProjectPlan } from "./schemas";
import { resolveDocumentCitations } from "@/lib/grounding/document-citations";
import { wouldCreateDependencyCycle } from "@/lib/pm/rules";

export interface GenerationSource {
  id: string;
  documentId: string;
  filename: string;
  content: string;
  chunkIndex: number;
  pageNumber: number | null;
  sectionTitle: string | null;
}

export type GenerationSourceMap = Map<string, GenerationSource>;

export interface ValidatedProposalCitation {
  sourceId: string;
  chunkId: string;
  excerpt: string;
}

export interface ValidatedCitedText {
  text: string;
  citations: ValidatedProposalCitation[];
}

export interface ValidatedMilestone {
  ref: string;
  title: string;
  description: string | null;
  targetDate: string | null;
  status: ModelProjectPlan["milestones"][number]["status"];
  citations: ValidatedProposalCitation[];
}

export interface ValidatedTask {
  ref: string;
  title: string;
  description: string | null;
  status: ModelProjectPlan["tasks"][number]["status"];
  priority: ModelProjectPlan["tasks"][number]["priority"];
  startDate: string | null;
  dueDate: string | null;
  milestoneRef: string | null;
  citations: ValidatedProposalCitation[];
  milestoneCitations: ValidatedProposalCitation[];
}

export interface ValidatedRisk {
  description: string;
  impact: ModelProjectPlan["risks"][number]["impact"];
  likelihood: ModelProjectPlan["risks"][number]["likelihood"];
  mitigation: string | null;
  status: ModelProjectPlan["risks"][number]["status"];
  milestoneRef: string | null;
  citations: ValidatedProposalCitation[];
  milestoneCitations: ValidatedProposalCitation[];
}

export interface ValidatedDependency {
  taskRef: string;
  dependsOnTaskRef: string;
  citations: ValidatedProposalCitation[];
}

export interface ValidatedProjectPlan {
  version: 1;
  scopeStatements: ValidatedCitedText[];
  deliverables: ValidatedCitedText[];
  acceptanceCriteria: ValidatedCitedText[];
  milestones: ValidatedMilestone[];
  tasks: ValidatedTask[];
  risks: ValidatedRisk[];
  dependencies: ValidatedDependency[];
  warnings: string[];
  droppedSourceIds: string[];
}

export class PlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanValidationError";
  }
}

function normalizeRef(value: string) {
  return value.trim().toUpperCase();
}

function normalizedText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function validateCitations(
  citations: Array<{ sourceId: string; quote: string }>,
  sourceMap: GenerationSourceMap,
  dropped: Set<string>,
) {
  const resolved = resolveDocumentCitations(citations, sourceMap);
  for (const sourceId of resolved.droppedSourceIds) dropped.add(sourceId);
  return resolved.citations;
}

/**
 * Resolves opaque source labels, removes unsupported proposals/links and makes
 * the graph safe before anything reaches the database.
 */
export function validateProjectPlan(
  model: ModelProjectPlan,
  sourceMap: GenerationSourceMap,
): ValidatedProjectPlan {
  const warnings: string[] = [];
  const dropped = new Set<string>();

  function citedText(
    rows: ModelProjectPlan["scopeStatements"],
    label: string,
  ): ValidatedCitedText[] {
    const seen = new Set<string>();
    const valid: ValidatedCitedText[] = [];
    for (const row of rows) {
      const key = normalizedText(row.text);
      if (seen.has(key)) {
        warnings.push(`Dropped duplicate ${label}: ${row.text}`);
        continue;
      }
      const citations = validateCitations(row.citations, sourceMap, dropped);
      if (citations.length === 0) {
        warnings.push(`Dropped uncited ${label}: ${row.text}`);
        continue;
      }
      seen.add(key);
      valid.push({ text: row.text, citations });
    }
    return valid;
  }

  const milestones: ValidatedMilestone[] = [];
  const milestoneRefs = new Set<string>();
  const milestoneTitles = new Set<string>();
  for (const row of model.milestones) {
    const ref = normalizeRef(row.ref);
    const titleKey = normalizedText(row.title);
    const citations = validateCitations(row.citations, sourceMap, dropped);
    if (milestoneRefs.has(ref) || milestoneTitles.has(titleKey)) {
      warnings.push(`Dropped duplicate milestone ${ref}: ${row.title}`);
      continue;
    }
    if (citations.length === 0) {
      warnings.push(`Dropped uncited milestone ${ref}: ${row.title}`);
      continue;
    }
    milestoneRefs.add(ref);
    milestoneTitles.add(titleKey);
    milestones.push({ ...row, ref, citations });
  }

  const tasks: ValidatedTask[] = [];
  const taskRefs = new Set<string>();
  const taskTitles = new Set<string>();
  for (const row of model.tasks) {
    const ref = normalizeRef(row.ref);
    const titleKey = normalizedText(row.title);
    const citations = validateCitations(row.citations, sourceMap, dropped);
    if (taskRefs.has(ref) || taskTitles.has(titleKey)) {
      warnings.push(`Dropped duplicate task ${ref}: ${row.title}`);
      continue;
    }
    if (citations.length === 0) {
      warnings.push(`Dropped uncited task ${ref}: ${row.title}`);
      continue;
    }
    if (
      row.startDate &&
      row.dueDate &&
      row.startDate.localeCompare(row.dueDate) > 0
    ) {
      warnings.push(`Dropped task ${ref} because its start date is after its due date`);
      continue;
    }

    let milestoneRef = row.milestoneRef ? normalizeRef(row.milestoneRef) : null;
    let milestoneCitations = validateCitations(
      row.milestoneCitations,
      sourceMap,
      dropped,
    );
    if (!milestoneRef) {
      milestoneCitations = [];
    } else if (
      !milestoneRefs.has(milestoneRef) ||
      milestoneCitations.length === 0
    ) {
      warnings.push(`Cleared unsupported milestone link on task ${ref}`);
      milestoneRef = null;
      milestoneCitations = [];
    }

    taskRefs.add(ref);
    taskTitles.add(titleKey);
    tasks.push({
      ...row,
      ref,
      milestoneRef,
      citations,
      milestoneCitations,
    });
  }

  const risks: ValidatedRisk[] = [];
  const riskDescriptions = new Set<string>();
  for (const row of model.risks) {
    const key = normalizedText(row.description);
    const citations = validateCitations(row.citations, sourceMap, dropped);
    if (riskDescriptions.has(key)) {
      warnings.push(`Dropped duplicate risk: ${row.description}`);
      continue;
    }
    if (citations.length === 0) {
      warnings.push(`Dropped uncited risk: ${row.description}`);
      continue;
    }

    let milestoneRef = row.milestoneRef ? normalizeRef(row.milestoneRef) : null;
    let milestoneCitations = validateCitations(
      row.milestoneCitations,
      sourceMap,
      dropped,
    );
    if (!milestoneRef) {
      milestoneCitations = [];
    } else if (
      !milestoneRefs.has(milestoneRef) ||
      milestoneCitations.length === 0
    ) {
      warnings.push(`Cleared unsupported milestone link on risk: ${row.description}`);
      milestoneRef = null;
      milestoneCitations = [];
    }

    riskDescriptions.add(key);
    risks.push({
      ...row,
      milestoneRef,
      citations,
      milestoneCitations,
    });
  }

  const dependencies: ValidatedDependency[] = [];
  const dependencyKeys = new Set<string>();
  for (const row of model.dependencies) {
    const taskRef = normalizeRef(row.taskRef);
    const dependsOnTaskRef = normalizeRef(row.dependsOnTaskRef);
    const key = `${taskRef}:${dependsOnTaskRef}`;
    const citations = validateCitations(row.citations, sourceMap, dropped);
    if (
      !taskRefs.has(taskRef) ||
      !taskRefs.has(dependsOnTaskRef) ||
      taskRef === dependsOnTaskRef ||
      dependencyKeys.has(key)
    ) {
      warnings.push(`Dropped invalid dependency ${taskRef} -> ${dependsOnTaskRef}`);
      continue;
    }
    if (citations.length === 0) {
      warnings.push(`Dropped uncited dependency ${taskRef} -> ${dependsOnTaskRef}`);
      continue;
    }
    if (
      wouldCreateDependencyCycle(
        dependencies.map((edge) => ({
          taskId: edge.taskRef,
          dependsOnTaskId: edge.dependsOnTaskRef,
        })),
        { taskId: taskRef, dependsOnTaskId: dependsOnTaskRef },
      )
    ) {
      warnings.push(`Dropped cyclic dependency ${taskRef} -> ${dependsOnTaskRef}`);
      continue;
    }
    dependencyKeys.add(key);
    dependencies.push({ taskRef, dependsOnTaskRef, citations });
  }

  if (milestones.length + tasks.length + risks.length === 0) {
    throw new PlanValidationError(
      "The model did not return any cited task, milestone, or risk",
    );
  }

  return {
    version: 1,
    scopeStatements: citedText(model.scopeStatements, "scope statement"),
    deliverables: citedText(model.deliverables, "deliverable"),
    acceptanceCriteria: citedText(
      model.acceptanceCriteria,
      "acceptance criterion",
    ),
    milestones,
    tasks,
    risks,
    dependencies,
    warnings,
    droppedSourceIds: [...dropped],
  };
}
