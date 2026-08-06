"use client";

import { useEffect, useRef } from "react";
import type { AnswerProgress } from "@/lib/rag/answer";
import { AssistantTurn, PendingTurn, UnansweredNotice, UserTurn } from "./turns";
import type { Turn } from "./types";

/**
 * The conversation, oldest first.
 *
 * Auto-scroll follows one rule: always go to a question the user just asked, but
 * only follow an arriving answer if they were already at the bottom. Yanking
 * someone out of an earlier answer they are re-reading is the classic chat bug.
 */
const NEAR_BOTTOM_PX = 120;

export function Transcript({
  turns,
  pending,
  phases,
  projectScoped,
  onRetry,
}: {
  turns: Turn[];
  pending: boolean;
  phases: AnswerProgress[];
  projectScoped: boolean;
  onRetry: (content: string) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const lastUserTurnCount = useRef(0);

  const userTurnCount = turns.filter((turn) => turn.kind === "user").length;
  const lastTurn = turns.at(-1);

  useEffect(() => {
    const askedJustNow = userTurnCount > lastUserTurnCount.current;
    lastUserTurnCount.current = userTurnCount;

    const distanceFromBottom =
      document.documentElement.scrollHeight -
      window.scrollY -
      window.innerHeight;
    if (!askedJustNow && distanceFromBottom > NEAR_BOTTOM_PX) return;

    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [userTurnCount, turns.length, phases.length]);

  return (
    // `role="log"` without aria-live: the phase indicator announces progress,
    // and a live region here would read entire multi-paragraph answers aloud.
    <div role="log" className="space-y-6 pb-4">
      {turns.map((turn, index) => {
        if (turn.kind === "user") {
          // A question stored with no reply after it — the answer failed after
          // the question was persisted, which the thread list now surfaces.
          const orphaned =
            turn.status === "sent" &&
            !pending &&
            turns[index + 1]?.kind !== "assistant";

          return (
            <div key={turn.id} className="space-y-2">
              <UserTurn
                turn={turn}
                onRetry={
                  turn.status === "failed" ? () => onRetry(turn.content) : undefined
                }
              />
              {orphaned ? (
                <UnansweredNotice onRetry={() => onRetry(turn.content)} />
              ) : null}
            </div>
          );
        }

        return (
          <AssistantTurn
            key={turn.id}
            turn={turn}
            projectScoped={projectScoped}
          />
        );
      })}

      {pending && lastTurn?.kind === "user" ? (
        <PendingTurn phases={phases} projectScoped={projectScoped} />
      ) : null}

      <div ref={endRef} />
    </div>
  );
}
