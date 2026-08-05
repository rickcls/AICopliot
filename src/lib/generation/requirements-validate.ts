import type { ModelRequirementProposal, ModelRequirements } from "./schemas";
import {
  PlanValidationError,
  type GenerationSourceMap,
  type ValidatedProposalCitation,
} from "./validate";
import { resolveDocumentCitations } from "@/lib/grounding/document-citations";

export interface ValidatedRequirement {
  title: string;
  description: string | null;
  type: ModelRequirementProposal["type"];
  priority: ModelRequirementProposal["priority"];
  acceptanceCriteria: string | null;
  assumptions: string | null;
  stakeholder: string | null;
  confidence: ModelRequirementProposal["confidence"];
  citations: ValidatedProposalCitation[];
}

export interface ValidatedRequirements {
  version: 1;
  requirements: ValidatedRequirement[];
  warnings: string[];
  droppedSourceIds: string[];
}

function normalizedText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/**
 * Resolves opaque source labels and removes unsupported proposals before
 * anything reaches the database.
 *
 * The uncited-requirement rule is the same hard gate as validateProjectPlan: a
 * requirement the model could not trace back to supplied text is not a weak
 * requirement, it is an invented one.
 */
export function validateRequirements(
  model: ModelRequirements,
  sourceMap: GenerationSourceMap,
): ValidatedRequirements {
  const warnings: string[] = [];
  const dropped = new Set<string>();
  const seen = new Set<string>();
  const requirements: ValidatedRequirement[] = [];

  for (const proposal of model.requirements) {
    const key = normalizedText(proposal.title);
    if (seen.has(key)) {
      warnings.push(`Dropped duplicate requirement: ${proposal.title}`);
      continue;
    }

    const resolved = resolveDocumentCitations(proposal.citations, sourceMap);
    for (const sourceId of resolved.droppedSourceIds) dropped.add(sourceId);
    if (resolved.citations.length === 0) {
      warnings.push(`Dropped uncited requirement: ${proposal.title}`);
      continue;
    }

    seen.add(key);
    requirements.push({
      title: proposal.title,
      description: proposal.description,
      type: proposal.type,
      priority: proposal.priority,
      acceptanceCriteria: proposal.acceptanceCriteria,
      assumptions: proposal.assumptions,
      stakeholder: proposal.stakeholder,
      confidence: proposal.confidence,
      citations: resolved.citations,
    });
  }

  if (requirements.length === 0) {
    throw new PlanValidationError(
      "The model returned no requirements supported by the selected documents.",
    );
  }

  return {
    version: 1,
    requirements,
    warnings,
    droppedSourceIds: [...dropped],
  };
}
