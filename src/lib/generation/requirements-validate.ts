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

/**
 * The comparison key for "is this the same requirement?": case, punctuation,
 * and spacing are ignored, wording is not. Deliberately strict — a looser
 * similarity check would silently drop a genuinely new obligation that happens
 * to share words with an old one, and a missed requirement is worse than a
 * duplicate a reviewer can reject in one click.
 */
export function requirementTitleKey(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
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
  /**
   * Titles already in the register. A proposal matching one is dropped: the
   * prompt asks the model not to repeat them, and this is the deterministic
   * backstop for when it does anyway.
   */
  existingTitles: readonly string[] = [],
): ValidatedRequirements {
  const warnings: string[] = [];
  const dropped = new Set<string>();
  const seen = new Set<string>();
  const existing = new Set(existingTitles.map(requirementTitleKey));
  const requirements: ValidatedRequirement[] = [];
  let alreadyRecorded = 0;

  for (const proposal of model.requirements) {
    const key = requirementTitleKey(proposal.title);
    if (existing.has(key)) {
      alreadyRecorded += 1;
      continue;
    }
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

  if (alreadyRecorded > 0) {
    warnings.push(
      `Skipped ${alreadyRecorded} requirement${alreadyRecorded === 1 ? "" : "s"} already in the register`,
    );
  }

  if (requirements.length === 0) {
    throw new PlanValidationError(
      alreadyRecorded > 0
        ? "Nothing new: every requirement found in these documents is already in the register."
        : "The model returned no requirements supported by the selected documents.",
    );
  }

  return {
    version: 1,
    requirements,
    warnings,
    droppedSourceIds: [...dropped],
  };
}
