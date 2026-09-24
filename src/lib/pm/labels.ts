import type { RequirementStatus } from "@/generated/prisma/enums";

/**
 * What a requirement's status is *called* on screen and in exports.
 *
 * The stored enum values describe the model (`needs_clarification`,
 * `approved`); these describe the job a PM or BA is doing with the row. Copy
 * changes happen here and nowhere else — never by renaming an enum value,
 * which would need a migration and would ripple through grounding and tests.
 */
export const REQUIREMENT_STATUS_LABEL: Record<RequirementStatus, string> = {
  draft: "To review",
  needs_clarification: "Ask client",
  validated: "Validated",
  approved: "Agreed",
  rejected: "Rejected",
};

export const REQUIREMENT_STATUS_HINT: Record<RequirementStatus, string> = {
  draft: "Extracted or written down, not yet checked by you",
  needs_clarification: "An open question to take back to the client",
  validated: "Checked by you, waiting for the client to agree",
  approved: "Agreed with the client — this is the scope",
  rejected: "Out of scope, kept for the record",
};

/** Accepts any string so exports can pass a plain `status` field. */
export function requirementStatusLabel(status: string): string {
  return status in REQUIREMENT_STATUS_LABEL
    ? REQUIREMENT_STATUS_LABEL[status as RequirementStatus]
    : status.replaceAll("_", " ");
}
