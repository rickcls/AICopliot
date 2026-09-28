import { parseSseChunk } from "@/lib/chat/sse";
import type { AnswerProgress } from "@/lib/rag/answer";
import { citationSchema, taskProposalSchema } from "@/lib/schemas";
import type { AssistantTurn } from "./types";

/**
 * Reading one answer off `/api/chat`, shared by the chat page and the task
 * panel so the two cannot drift in how they treat a guard error, a dropped
 * stream, or a superseded request.
 */

export interface AcceptedFrame {
  conversationId: string;
  title: string;
  questionMessageId: string;
  createdAt: string;
}

export interface ResultFrame {
  messageId: string;
  conversationId: string;
  answer: string;
  confidence: "high" | "medium" | "low";
  citations: unknown;
  proposals?: unknown;
  refused: boolean;
  latencyMs: number;
  createdAt: string;
}

export interface AnswerStreamHandlers {
  onAccepted: (frame: AcceptedFrame) => void;
  onProgress: (progress: AnswerProgress) => void;
  onResult: (frame: ResultFrame) => void;
  onError: (message: string) => void;
  /** False once a newer question has replaced this one. */
  isCurrent: () => boolean;
}

export type StreamOutcome = "answered" | "failed" | "superseded";

export async function streamAnswer(
  body: Record<string, unknown>,
  handlers: AnswerStreamHandlers,
): Promise<StreamOutcome> {
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    // Guards return JSON with a real status; only a 200 carries a stream.
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      handlers.onError(data.error ?? "Could not get an answer.");
      return "failed";
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let outcome: StreamOutcome | null = null;

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!handlers.isCurrent()) return "superseded";

      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = parseSseChunk(buffer);
      buffer = rest;

      for (const frame of events) {
        const payload = JSON.parse(frame.data);
        if (frame.event === "accepted") handlers.onAccepted(payload);
        else if (frame.event === "progress") handlers.onProgress(payload);
        else if (frame.event === "result") {
          outcome = "answered";
          handlers.onResult(payload);
        } else if (frame.event === "error") {
          outcome = "failed";
          handlers.onError(payload.error ?? "Could not get an answer.");
        }
      }
    }

    if (outcome) return outcome;
    handlers.onError("The answer stream ended unexpectedly.");
    return "failed";
  } catch {
    if (!handlers.isCurrent()) return "superseded";
    handlers.onError("Could not reach the server. Please try again.");
    return "failed";
  }
}

/**
 * A streamed result as a transcript turn. Citations and proposals cross the
 * wire as JSON, so both are re-validated here for the same reason a stored
 * blob is: the renderer must never be handed a shape it cannot narrow.
 */
export function assistantTurnFrom(result: ResultFrame): AssistantTurn {
  const citations = citationSchema.array().safeParse(result.citations);
  const proposals = taskProposalSchema.array().safeParse(result.proposals ?? []);
  return {
    kind: "assistant",
    id: result.messageId,
    content: result.answer,
    citations: citations.success ? citations.data : [],
    citationsUnavailable: !citations.success && !result.refused,
    confidence: result.confidence,
    refused: result.refused,
    latencyMs: result.latencyMs,
    createdAt: result.createdAt,
    myRating: null,
    proposals: proposals.success ? proposals.data : [],
  };
}
