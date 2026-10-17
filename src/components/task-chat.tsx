"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, ExternalLink, Plus } from "lucide-react";
import { assistantTurnFrom, streamAnswer } from "@/components/chat/ask-stream";
import {
  ProposalCard,
  type CurrentTaskValues,
} from "@/components/chat/proposal-card";
import { Transcript } from "@/components/chat/transcript";
import { toTurns, type Turn } from "@/components/chat/types";
import { useT } from "@/components/i18n-provider";
import { Button, ErrorState, Spinner, Textarea } from "@/components/ui";
import type { LoadedConversation } from "@/lib/chat/history";
import type { AnswerProgress } from "@/lib/rag/answer";
import type { TaskProposal } from "@/lib/schemas";

const SUGGESTIONS = ["involve", "description", "deadline"] as const;

/**
 * A conversation about one task, inside its detail panel.
 *
 * Same pipeline and same rules as the Ask page — it is a task-focused thread
 * there too, and "Open in Ask" continues it full width. What the panel adds is
 * the task itself: proposals compare against its live values and apply through
 * the panel's own save, so the fields above update the moment you click.
 *
 * The latest thread is fetched when the tab opens, like comments; the panel is
 * keyed on the task, so another task starts from its own thread.
 */
export function TaskChat({
  taskId,
  linkedDocumentCount,
  current,
  onApply,
}: {
  taskId: string;
  linkedDocumentCount: number;
  current: CurrentTaskValues;
  onApply: (proposal: TaskProposal) => Promise<boolean>;
}) {
  const [loaded, setLoaded] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [phases, setPhases] = useState<AnswerProgress[]>([]);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const t = useT();

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/tasks/${taskId}/conversation`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error ?? t("tasks.chat.loadFailed"));
        const conversation = data.conversation as LoadedConversation | null;
        if (conversation) {
          setConversationId(conversation.conversation.id);
          setTurns(toTurns(conversation.turns));
        }
      })
      .catch((cause: Error) => {
        if (controller.signal.aborted) return;
        setError(cause.message || t("tasks.chat.loadFailed"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoaded(true);
      });
    return () => controller.abort();
  }, [taskId, t]);

  async function ask(content: string) {
    const trimmed = content.trim();
    if (trimmed.length < 3 || pending) return;

    const generation = (requestId.current += 1);
    const localId = `pending-${generation}`;
    setPending(true);
    setPhases([]);
    setError(null);
    setQuestion("");
    setTurns((previous) => [
      ...previous,
      { kind: "user", id: localId, content: trimmed, status: "sending", createdAt: new Date().toISOString() },
    ]);

    const outcome = await streamAnswer(
      { question: trimmed, conversationId, taskId },
      {
        isCurrent: () => generation === requestId.current,
        onAccepted: (payload) => {
          setConversationId(payload.conversationId);
          setTurns((previous) =>
            previous.map((turn) =>
              turn.id === localId && turn.kind === "user"
                ? { ...turn, id: payload.questionMessageId, status: "sent" }
                : turn,
            ),
          );
        },
        onProgress: (progress) => setPhases((previous) => [...previous, progress]),
        onResult: (payload) =>
          setTurns((previous) => [...previous, assistantTurnFrom(payload)]),
        onError: (message) => {
          setError(message);
          setTurns((previous) =>
            previous.map((turn) =>
              turn.id === localId && turn.kind === "user"
                ? { ...turn, status: "failed" }
                : turn,
            ),
          );
        },
      },
    );
    if (outcome === "superseded") return;
    setPending(false);
    setPhases([]);
  }

  function newThread() {
    requestId.current += 1;
    setConversationId(undefined);
    setTurns([]);
    setPending(false);
    setPhases([]);
    setError(null);
  }

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-slate-500">
        <Spinner className="size-4" />
        {t("tasks.chat.loading")}
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="mr-auto">
            {linkedDocumentCount > 0
              ? t("tasks.chat.readsLinked", { count: linkedDocumentCount })
              : t("tasks.chat.readsProject")}
          </span>
          {conversationId ? (
            <>
              <a
                href={`/chat/${conversationId}`}
                className="inline-flex items-center gap-1 rounded px-1.5 py-1 hover:bg-slate-100 hover:text-slate-800"
              >
                <ExternalLink className="size-3.5" aria-hidden />
                {t("tasks.chat.openInAsk")}
              </a>
              <button
                type="button"
                onClick={newThread}
                disabled={pending}
                className="inline-flex items-center gap-1 rounded px-1.5 py-1 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
              >
                <Plus className="size-3.5" aria-hidden />
                {t("tasks.chat.newThread")}
              </button>
            </>
          ) : null}
        </div>

        {turns.length === 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">{t("tasks.chat.intro")}</p>
            <ul className="space-y-1.5">
              {SUGGESTIONS.map((key) => {
                const suggestion = t(`tasks.chat.suggestions.${key}`);
                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => void ask(suggestion)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                    >
                      {suggestion}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <Transcript
            turns={turns}
            pending={pending}
            phases={phases}
            projectScoped
            onRetry={ask}
            renderProposals={(turn) => (
              <div className="space-y-2">
                {turn.proposals.map((proposal) => (
                  <ProposalCard
                    key={proposal.field}
                    proposal={proposal}
                    current={current}
                    onApply={onApply}
                  />
                ))}
              </div>
            )}
          />
        )}

        {error ? <ErrorState message={error} /> : null}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
        className="sticky bottom-0 border-t border-slate-200 bg-white p-3"
      >
        <div className="flex items-end gap-2 rounded-2xl border border-slate-300 p-1.5 focus-within:border-slate-900">
          <label htmlFor="task-chat-question" className="sr-only">
            {t("tasks.chat.inputLabel")}
          </label>
          <Textarea
            id="task-chat-question"
            rows={1}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey) return;
              event.preventDefault();
              void ask(question);
            }}
            placeholder={t("tasks.chat.placeholder")}
            disabled={pending}
            className="max-h-40 min-h-9 resize-none border-transparent bg-transparent px-2 py-1.5 focus-visible:border-transparent focus-visible:ring-0"
          />
          <Button
            type="submit"
            size="icon"
            aria-label={t("tasks.chat.ask")}
            disabled={pending || question.trim().length < 3}
            className="rounded-full"
          >
            {pending ? (
              <Spinner className="size-3.5 border-white/40 border-t-white" />
            ) : (
              <ArrowUp className="size-4" aria-hidden />
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
