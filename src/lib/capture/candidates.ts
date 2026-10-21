/**
 * Which of a person's open tasks to show the model as T1..Tn.
 *
 * A capture usually updates work that already exists ("月報交咗"), so the
 * model needs the candidates — but not all of them, and never their ids. Tasks
 * whose titles share words with the capture come first; the remaining slots go
 * to work due soonest, then most recently touched, because that is what a
 * person tends to report on.
 *
 * "Words" are Latin words of three letters or more and Chinese character
 * pairs, since written Chinese has no spaces to split on.
 */

const LATIN_WORD = /[a-z0-9]{3,}/g;
const HAN_RUN = /\p{Script=Han}+/gu;

export function overlapTokens(text: string): Set<string> {
  const lower = text.toLowerCase();
  const tokens = new Set<string>(lower.match(LATIN_WORD) ?? []);
  for (const run of lower.match(HAN_RUN) ?? []) {
    for (let i = 0; i + 1 < run.length; i++) tokens.add(run.slice(i, i + 2));
  }
  return tokens;
}

export interface CandidateTask {
  title: string;
  dueDate: Date | null;
  updatedAt: Date;
}

/**
 * Tasks whose titles share a word with `text`, best match first.
 *
 * Unlike `rankTaskCandidates`, a title with nothing in common is left out.
 * That is what makes it safe to hand the matches to the assistant as update
 * targets: a question about one task must not offer every other open task.
 */
export function tasksMatchingText<T extends CandidateTask>(
  tasks: readonly T[],
  text: string,
  today: Date,
  limit = 12,
): T[] {
  const wanted = overlapTokens(text);
  if (wanted.size === 0) return [];
  const matched = tasks.filter((task) => {
    for (const token of overlapTokens(task.title)) {
      if (wanted.has(token)) return true;
    }
    return false;
  });
  return rankTaskCandidates(matched, text, today, limit);
}

export function rankTaskCandidates<T extends CandidateTask>(
  tasks: readonly T[],
  captureText: string,
  today: Date,
  limit = 40,
): T[] {
  const captureTokens = overlapTokens(captureText);
  const scored = tasks.map((task) => {
    let score = 0;
    for (const token of overlapTokens(task.title)) {
      if (captureTokens.has(token)) score += 1;
    }
    const distance = task.dueDate
      ? Math.abs(task.dueDate.getTime() - today.getTime())
      : Number.POSITIVE_INFINITY;
    return { task, score, distance };
  });

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.distance - b.distance ||
      b.task.updatedAt.getTime() - a.task.updatedAt.getTime(),
  );
  return scored.slice(0, limit).map((entry) => entry.task);
}
