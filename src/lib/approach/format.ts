import type { ApproachStep } from "@/lib/approach/approach";

/**
 * Formatting for approach steps, kept apart from approach.ts so the browser
 * bundle does not pull in the validator and its OpenCC dictionary.
 */

/** Plain text for appending steps to a task description, general steps marked. */
export function stepsAsDescription(
  steps: ApproachStep[],
  generalMarker: string,
): string {
  return steps
    .map((step, index) => `${index + 1}. ${step.basis === "general" ? `${generalMarker} ` : ""}${step.text}`)
    .join("\n");
}

/** A step's first sentence, as a task title. */
export function stepTitle(text: string): string {
  const first = text.split(/(?<=[。！？.!?])\s*/u)[0] ?? text;
  const title = first.trim() || text.trim();
  return title.length > 120 ? `${title.slice(0, 119)}…` : title;
}
