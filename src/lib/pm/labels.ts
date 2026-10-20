import type { RequirementStatus } from "@/generated/prisma/enums";
import type { Translate } from "@/lib/i18n/translate";

/**
 * What a requirement's status is *called* on screen and in exports.
 *
 * The stored enum values describe the model (`needs_clarification`,
 * `approved`); the words under `requirementStatus` in the dictionaries describe
 * the job a PM or BA is doing with the row. Copy changes happen there and
 * nowhere else — never by renaming an enum value, which would need a migration
 * and would ripple through grounding and tests.
 */
const REQUIREMENT_STATUSES: readonly string[] = [
  "draft",
  "needs_clarification",
  "validated",
  "approved",
  "rejected",
] satisfies RequirementStatus[];

function isRequirementStatus(status: string): status is RequirementStatus {
  return REQUIREMENT_STATUSES.includes(status);
}

/** Accepts any string so exports can pass a plain `status` field. */
export function requirementStatusLabel(status: string, t: Translate): string {
  return isRequirementStatus(status)
    ? t(`requirementStatus.${status}`)
    : status.replaceAll("_", " ");
}

export function requirementStatusHint(status: RequirementStatus, t: Translate): string {
  return t(`requirementStatusHint.${status}`);
}
