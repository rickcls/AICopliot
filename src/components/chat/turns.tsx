"use client";

import { Check, RotateCcw, Sparkles } from "lucide-react";
import type { AnswerProgress } from "@/lib/rag/answer";
import { useT } from "@/components/i18n-provider";
import { Badge, Button, Spinner, type BadgeTone } from "@/components/ui";
import type { Translate } from "@/lib/i18n/translate";
import { cn } from "@/lib/utils";
import { AnswerBody } from "./answer-body";
import { FeedbackButtons } from "./feedback-buttons";
import { NextActions } from "./next-actions";
import { SourceCard } from "./source-card";
import type { AssistantTurn as AssistantTurnModel, UserTurn as UserTurnModel } from "./types";

const CONFIDENCE_TONE: Record<"high" | "medium" | "low", BadgeTone> = {
  high: "success",
  medium: "warning",
  low: "neutral",
};

/**
 * A question, as a short right-aligned bubble. Answers stay full width and
 * unboxed below: long prose in a bubble is harder to read, and only one side of
 * the conversation is ever short enough for the shape to help.
 */
export function UserTurn({
  turn,
  onRetry,
}: {
  turn: UserTurnModel;
  onRetry?: () => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div
        className={cn(
          "max-w-[85%] rounded-2xl rounded-br-md bg-sand-100 px-4 py-2.5 text-sm text-pretty whitespace-pre-wrap text-sand-900",
          turn.status === "failed" && "bg-red-50 text-red-900",
        )}
      >
        {turn.content}
      </div>
      {/* The failure belongs to the turn that caused it, not to the page. */}
      {turn.status === "failed" && onRetry ? (
        <Button variant="ghost" size="sm" onClick={onRetry} className="text-red-700">
          <RotateCcw className="size-3.5" aria-hidden />
          {t("chat.turn.retry")}
        </Button>
      ) : null}
    </div>
  );
}

/** A question persisted with no reply — the answer failed after it was stored. */
export function UnansweredNotice({ onRetry }: { onRetry?: () => void }) {
  const t = useT();
  return (
    <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3">
      <p className="text-xs text-amber-800">
        {t("chat.turn.unanswered")}
      </p>
      {onRetry ? (
        <Button variant="ghost" size="sm" onClick={onRetry} className="ml-auto shrink-0">
          <RotateCcw className="size-3.5" aria-hidden />
          {t("chat.turn.askAgain")}
        </Button>
      ) : null}
    </div>
  );
}

export function AssistantTurn({
  turn,
  projectScoped,
  proposals,
}: {
  turn: AssistantTurnModel;
  projectScoped: boolean;
  /** Apply-able edits, rendered by whoever can apply them. */
  proposals?: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex gap-3">
      <span
        aria-hidden
        className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-sand-900 text-white"
      >
        <Sparkles className="size-3.5" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {turn.refused ? (
            <Badge tone="warning">{t("chat.turn.noEvidence")}</Badge>
          ) : turn.confidence ? (
            <Badge tone={CONFIDENCE_TONE[turn.confidence]}>
              {t("chat.turn.confidence", { level: t(`confidence.${turn.confidence}`) })}
            </Badge>
          ) : null}
          {turn.latencyMs !== null ? (
            <span className="text-xs text-sand-400">
              {(turn.latencyMs / 1000).toFixed(1)}s
            </span>
          ) : null}
        </div>

        <AnswerBody
          messageId={turn.id}
          text={turn.content}
          citations={turn.citations}
        />

        {proposals ? <div className="mt-4">{proposals}</div> : null}

        {turn.refused ? (
          <p className="mt-3 text-xs text-sand-500">
            {projectScoped ? t("chat.turn.refusedProject") : t("chat.turn.refusedDocuments")}
          </p>
        ) : null}

        {turn.citationsUnavailable ? (
          // Never render a historic answer as an uncited assertion, even though
          // it was properly cited when it was produced.
          <p className="mt-3 text-xs text-sand-500">
            {t("chat.turn.sourcesGone")}
          </p>
        ) : null}

        {turn.citations.length > 0 ? (
          <div className="mt-4">
            <h3 className="text-xs font-semibold tracking-wide text-sand-500 uppercase">
              {t("chat.turn.sources", { count: turn.citations.length })}
            </h3>
            <div className="mt-2 space-y-2">
              {turn.citations.map((citation, index) => (
                <SourceCard
                  key={
                    citation.kind === "document"
                      ? `document-${citation.chunkId}-${index}`
                      : `${citation.kind}-${citation.href}-${index}`
                  }
                  citation={citation}
                  messageId={turn.id}
                />
              ))}
            </div>
          </div>
        ) : null}

        <NextActions citations={turn.citations} />

        <div className="mt-4 border-t border-sand-100 pt-3">
          <FeedbackButtons messageId={turn.id} initialRating={turn.myRating} />
        </div>
      </div>
    </div>
  );
}

/**
 * What the pipeline is actually doing, rather than a spinner.
 *
 * These are real boundaries inside `answerQuestion`, which is why the list is
 * allowed to be uneven: a first question has no rewrite step and skips it, and a
 * question with no evidence stops after retrieval without ever reaching
 * "Drafting" — the refusal arriving with no drafting step is the visible form of
 * the guard that refuses before spending a model call.
 */
function phaseLabel(progress: AnswerProgress, projectScoped: boolean, t: Translate): string {
  switch (progress.phase) {
    case "rewriting":
      return t("chat.turn.phases.rewriting");
    case "retrieving":
      return projectScoped
        ? t("chat.turn.phases.retrievingProject")
        : t("chat.turn.phases.retrieving");
    case "retrieved": {
      const records = progress.projectSourceCount ?? 0;
      const passages = t("chat.turn.phases.passages", { count: progress.chunkCount ?? 0 });
      return records > 0
        ? t("chat.turn.phases.foundBoth", {
            passages,
            records: t("chat.turn.phases.records", { count: records }),
          })
        : t("chat.turn.phases.found", { passages });
    }
    case "repairing":
      return t("chat.turn.phases.repairing");
    case "validating":
      return t("chat.turn.phases.validating");
    default:
      return t("chat.turn.phases.drafting");
  }
}

export function PendingTurn({
  phases,
  projectScoped,
}: {
  phases: AnswerProgress[];
  projectScoped: boolean;
}) {
  const current = phases.at(-1);
  const t = useT();

  return (
    <div className="flex gap-3">
      <span
        aria-hidden
        className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-sand-900 text-white"
      >
        <Sparkles className="size-3.5 animate-pulse" />
      </span>

      <div className="min-w-0 flex-1 space-y-1.5 pt-1">
        {phases.slice(0, -1).map((progress, index) => (
          <p
            key={`${progress.phase}-${index}`}
            aria-hidden
            className="flex items-center gap-2 text-xs text-sand-400"
          >
            <Check className="size-3.5 shrink-0 text-emerald-500" />
            {phaseLabel(progress, projectScoped, t)}
          </p>
        ))}
        {/* One polite live region for the current step only. Putting aria-live
            on the transcript would read whole answers aloud on arrival. */}
        <p
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 text-xs font-medium text-sand-600"
        >
          <Spinner className="size-3.5 shrink-0" />
          {current ? phaseLabel(current, projectScoped, t) : t("chat.turn.starting")}
        </p>
      </div>
    </div>
  );
}
