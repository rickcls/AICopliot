import type { ChatProvider } from "@/lib/providers";

/**
 * Follow-up question rewriting.
 *
 * Retrieval embeds the question directly, so a follow-up like "what about for
 * Sev-2?" embeds almost no usable signal — the subject lives in the previous
 * turn. Rewriting it into a standalone question BEFORE embedding is what makes
 * multi-turn conversation work at all; passing history only to the answering
 * model would fix the wording but still retrieve against the wrong vector.
 */

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** Turns fed to the rewriter. More than this adds cost without helping. */
const MAX_HISTORY_TURNS = 6;
const MAX_TURN_CHARS = 500;
/** Longest a rewritten question may be before we assume the model answered. */
const MIN_REWRITE_BUDGET = 240;

const REWRITE_SYSTEM_PROMPT = `You rewrite follow-up questions so they can be understood on their own.

Given a conversation and the user's latest message, output a single self-contained question that preserves the user's intent and resolves any pronouns or references using the conversation.

Rules:
- Output ONLY the rewritten question. No preamble, no quotes, no explanation.
- Keep the user's own terminology, especially product names, hostnames, commands, and error codes.
- If the latest message is already self-contained, output it unchanged.
- Never answer the question. Never add information that is not in the conversation.`;

export function needsRewrite(history: ChatTurn[]): boolean {
  return history.length > 0;
}

/**
 * Returns a standalone version of `question`. Falls back to the original
 * question on any failure — a bad rewrite must never block an answer.
 */
export async function rewriteQuestion(
  question: string,
  history: ChatTurn[],
  chat: ChatProvider,
): Promise<string> {
  if (!needsRewrite(history)) return question;

  const recent = history.slice(-MAX_HISTORY_TURNS).map((turn) => {
    const speaker = turn.role === "user" ? "User" : "Assistant";
    return `${speaker}: ${turn.content.slice(0, MAX_TURN_CHARS)}`;
  });

  try {
    const raw = await chat.complete(
      [
        { role: "system", content: REWRITE_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Conversation:\n${recent.join("\n")}\n\nLatest message: ${question}\n\nRewritten standalone question:`,
        },
      ],
      { temperature: 0, maxTokens: 200 },
    );

    const rewritten = raw.trim().replace(/^["']|["']$/g, "");

    // Guard against a model that ignored the instruction and answered instead.
    // A standalone question stays short; a paragraph means it answered. The
    // absolute floor matters because a terse follow-up ("what about Sev-2?")
    // gives a relative limit almost nothing to work with.
    const maxLength = Math.max(MIN_REWRITE_BUDGET, question.length * 3);
    if (rewritten.length === 0 || rewritten.length > maxLength) {
      return question;
    }
    return rewritten;
  } catch {
    return question;
  }
}
