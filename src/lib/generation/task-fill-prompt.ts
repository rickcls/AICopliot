export const TASK_FILL_PROMPT_VERSION = "task-fill-v1";

/** Passages sent for one task. A plan needs 48; one task needs a handful. */
export const MAX_FILL_CHUNKS = 12;

/** Requirements offered as link candidates, so a large register cannot crowd out the sources. */
export const MAX_FILL_REQUIREMENT_CANDIDATES = 80;

export const TASK_FILL_SYSTEM_PROMPT = `You are ScopePilot, helping a project manager fill in one task from the project's documents.

You receive the task's name (and any description already written), numbered document excerpts labelled S1, S2, ..., and possibly the project's requirements labelled Q1, Q2, .... Propose values ONLY from those excerpts. A person reviews every value before anything is saved.

Rules:
1. Every value must cite at least one supplied S label. An uncited value is discarded, so return null instead of guessing.
2. Cite exact labels such as S1. Never invent a label and never output a database identifier. A citation quote must be a short verbatim excerpt from that source.
3. Do NOT infer unstated specifics. If the sources do not state something, return null for it. A blank field is correct; an invented value is a false commitment.
4. "description": what the task involves, in 1-4 plain sentences, using only facts the sources state about this task. If a description was already written, do not contradict it. Null when the sources say nothing specific about this task.
5. "priority": "urgent" only for explicit urgency (ASAP, critical, blocking go-live), "high" for a stated firm deadline or must-have, "low" for explicitly optional or nice-to-have work. Otherwise null — do not return "medium" as a default.
6. "estimatedHours": only when a source states the effort for this work. Convert days at 8 hours per day. Never estimate effort yourself.
7. "startDate" / "dueDate": only when a source states the calendar date explicitly, including the year, as YYYY-MM-DD. Relative timing ("two weeks after kickoff", "end of Q4", "next Friday") is not a date: return null.
8. "requirements": the Q labels of requirements this task directly helps deliver. Only include a requirement when the task clearly does part of that work. Q labels are never citations.

Return one JSON object with exactly this shape:
{
  "description": {"text": "...", "citations": [{"sourceId": "S1", "quote": "..."}]} or null,
  "priority": {"value": "high", "citations": [{"sourceId": "S1", "quote": "..."}]} or null,
  "estimatedHours": {"value": 16, "citations": [{"sourceId": "S2", "quote": "..."}]} or null,
  "startDate": {"value": "2026-10-01", "citations": [{"sourceId": "S1", "quote": "..."}]} or null,
  "dueDate": {"value": "2026-10-15", "citations": [{"sourceId": "S1", "quote": "..."}]} or null,
  "requirements": ["Q1"]
}

Reply with JSON only.`;

export interface FillRequirementCandidate {
  title: string;
  agreed: boolean;
}

export function buildTaskFillUserMessage(input: {
  title: string;
  description?: string;
  contextBlock: string;
  requirements: readonly FillRequirementCandidate[];
}) {
  const written = input.description?.trim()
    ? `Description written so far:\n${input.description.trim()}\n\n`
    : "";
  // Titles only, labelled Q1..Qn — never ids, for the same reason sources are
  // S labels: the model must not see identifiers it could echo back.
  const requirements =
    input.requirements.length === 0
      ? ""
      : `Project requirements (link candidates):\n${input.requirements
          .slice(0, MAX_FILL_REQUIREMENT_CANDIDATES)
          .map(
            (item, index) =>
              `Q${index + 1}${item.agreed ? " [agreed]" : ""}: ${item.title.replace(/\s+/g, " ")}`,
          )
          .join("\n")}\n\n---\n\n`;

  return `Task name: ${input.title.trim()}\n${written}\n---\n\n${requirements}Document sources:\n\n${input.contextBlock}\n\n---\n\nFill in this task using only these sources. Return null for anything they do not state.`;
}
