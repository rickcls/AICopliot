import type { ConversationTurn } from "@/lib/chat/history";
import type { Citation, Confidence } from "@/lib/schemas";

/**
 * The transcript's own turn model.
 *
 * A replayed turn and a turn that just arrived over the stream have to render
 * identically, so both are normalised into this shape. The extra `status` on a
 * user turn is the one thing the server has no opinion about: it exists only
 * between hitting Ask and the answer landing.
 */

export interface UserTurn {
  kind: "user";
  id: string;
  content: string;
  status: "sending" | "sent" | "failed";
  createdAt: string;
}

export interface AssistantTurn {
  kind: "assistant";
  id: string;
  content: string;
  citations: Citation[];
  citationsUnavailable: boolean;
  confidence: Confidence | null;
  refused: boolean;
  latencyMs: number | null;
  createdAt: string;
  myRating: "up" | "down" | null;
}

export type Turn = UserTurn | AssistantTurn;

export interface ProjectOption {
  id: string;
  name: string;
  readyDocumentCount: number;
  liveRecordCount: number;
}

export function toTurns(stored: ConversationTurn[]): Turn[] {
  return stored.map((turn) =>
    turn.role === "user"
      ? {
          kind: "user",
          id: turn.id,
          content: turn.content,
          status: "sent",
          createdAt: turn.createdAt,
        }
      : {
          kind: "assistant",
          id: turn.id,
          content: turn.content,
          citations: turn.citations,
          citationsUnavailable: turn.citationsUnavailable,
          confidence: turn.confidence,
          refused: turn.refused,
          latencyMs: turn.latencyMs,
          createdAt: turn.createdAt,
          myRating: turn.myRating,
        },
  );
}
