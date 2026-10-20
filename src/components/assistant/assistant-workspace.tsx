"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Plus, Send, Trash2 } from "lucide-react";
import { AssistantMessage } from "@/components/assistant/assistant-message";
import type { ProjectOption } from "@/components/capture/proposal-list";
import { useConfirm } from "@/components/confirm-dialog";
import { useT } from "@/components/i18n-provider";
import { useToast } from "@/components/toast";
import { Button, Card, ErrorState, FilterChip, FOCUS_RING, Spinner, Textarea } from "@/components/ui";
import type { AssistantMessageView } from "@/lib/assistant/service";
import { cn } from "@/lib/utils";

export interface ThreadSummary {
  id: string;
  title: string;
}

/**
 * The assistant page: conversations on the side, the current one in the
 * middle, the question box at the bottom. A turn is one request — the
 * assistant's lookups happen inside it — so the box waits for the answer
 * rather than streaming partial steps.
 */
export function AssistantWorkspace({
  threads,
  threadId,
  messages,
  projects,
  webSearchAvailable,
}: {
  threads: ThreadSummary[];
  threadId: string | null;
  messages: AssistantMessageView[];
  projects: ProjectOption[];
  webSearchAvailable: boolean;
}) {
  // Lives above the keyed conversation, so the first answer (which creates a
  // thread and remounts the conversation) does not snap the switch back off.
  const [webSearch, setWebSearch] = useState(false);
  return (
    <AssistantConversation
      key={threadId ?? "new"}
      threads={threads}
      threadId={threadId}
      messages={messages}
      projects={projects}
      webSearch={webSearchAvailable && webSearch}
      webSearchAvailable={webSearchAvailable}
      onWebSearchChange={setWebSearch}
    />
  );
}

function AssistantConversation({
  threads: initialThreads,
  threadId: initialThreadId,
  messages: initialMessages,
  projects,
  webSearch,
  webSearchAvailable,
  onWebSearchChange,
}: {
  threads: ThreadSummary[];
  threadId: string | null;
  messages: AssistantMessageView[];
  projects: ProjectOption[];
  webSearch: boolean;
  webSearchAvailable: boolean;
  onWebSearchChange: (on: boolean) => void;
}) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const inputId = useId();
  const bottom = useRef<HTMLDivElement>(null);
  // Keys for questions shown before the server has stored them.
  const pendingCount = useRef(0);
  const [threads, setThreads] = useState(initialThreads);
  const [threadId, setThreadId] = useState(initialThreadId);
  const [messages, setMessages] = useState(initialMessages);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    pendingCount.current += 1;
    const pending: AssistantMessageView = {
      id: `pending-${pendingCount.current}`,
      role: "user",
      content: trimmed,
      sources: [],
      steps: [],
      general: false,
      drafts: [],
      proposals: [],
      createdAt: "",
    };
    setMessages((list) => [...list, pending]);
    setQuestion("");
    requestAnimationFrame(() => bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          webSearch,
          ...(threadId ? { threadId } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.message) {
        setError(data.error ?? t("assistant.failed"));
        return;
      }
      setMessages((list) => [...list, data.message as AssistantMessageView]);
      if (!threadId) {
        setThreadId(data.threadId);
        setThreads((list) => [{ id: data.threadId, title: trimmed.slice(0, 80) }, ...list]);
        router.replace(`/assistant?thread=${data.threadId}`, { scroll: false });
      }
      requestAnimationFrame(() => bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
    } catch {
      setError(t("common.couldNotReach"));
    } finally {
      setBusy(false);
    }
  }

  async function removeThread(id: string) {
    const ok = await confirm({
      title: t("assistant.deleteTitle"),
      body: t("assistant.deleteBody"),
      confirmLabel: t("assistant.deleteThread"),
      tone: "danger",
    });
    if (!ok) return;
    const response = await fetch(`/api/assistant/threads/${id}`, { method: "DELETE" });
    if (!response.ok && response.status !== 404) {
      toast.error(t("common.couldNotReach"));
      return;
    }
    setThreads((list) => list.filter((thread) => thread.id !== id));
    if (id === threadId) router.push("/assistant");
  }

  const examples = [t("assistant.example1"), t("assistant.example2"), t("assistant.example3")];

  return (
    <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <aside className="space-y-2">
        <Link
          href="/assistant"
          className={cn(
            "flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50",
            FOCUS_RING,
          )}
        >
          <Plus className="size-4" aria-hidden />
          {t("assistant.newThread")}
        </Link>
        <p className="px-1 pt-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">
          {t("assistant.threads")}
        </p>
        {threads.length === 0 ? (
          <p className="px-1 text-xs text-slate-500">{t("assistant.noThreads")}</p>
        ) : (
          <ul className="space-y-0.5">
            {threads.map((thread) => (
              <li key={thread.id} className="group flex items-center gap-1">
                <Link
                  href={`/assistant?thread=${thread.id}`}
                  aria-current={thread.id === threadId ? "true" : undefined}
                  className={cn(
                    "min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-sm",
                    thread.id === threadId ? "bg-slate-100 font-medium text-slate-900" : "text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {thread.title}
                </Link>
                <button
                  type="button"
                  onClick={() => void removeThread(thread.id)}
                  title={t("assistant.deleteThread")}
                  className={cn("rounded p-1 text-slate-300 hover:text-red-700 sm:opacity-0 sm:group-hover:opacity-100", FOCUS_RING)}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  <span className="sr-only">{t("assistant.deleteThread")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="min-w-0 space-y-6">
        {messages.length === 0 ? (
          <Card className="p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Bot className="size-4 text-slate-400" aria-hidden />
              {t("assistant.title")}
            </div>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">{t("assistant.lead")}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {examples.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => void ask(example)}
                  disabled={busy}
                  className={cn(
                    "rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50",
                    FOCUS_RING,
                  )}
                >
                  {example}
                </button>
              ))}
            </div>
          </Card>
        ) : (
          <ol className="space-y-6">
            {messages.map((message) => (
              <li key={message.id}>
                {message.role === "user" ? (
                  <div className="ml-auto max-w-[85%] rounded-xl bg-slate-900 px-4 py-2.5 text-sm whitespace-pre-wrap text-white">
                    <span className="sr-only">{t("assistant.you")}: </span>
                    {message.content}
                  </div>
                ) : (
                  <AssistantMessage
                    message={message}
                    projects={projects}
                    onChange={(updated) =>
                      setMessages((list) => list.map((row) => (row.id === updated.id ? updated : row)))
                    }
                  />
                )}
              </li>
            ))}
          </ol>
        )}

        {busy ? (
          <p className="flex items-center gap-2 text-sm text-slate-500" aria-live="polite">
            <Spinner /> {t("assistant.thinking")}
          </p>
        ) : null}
        {error ? <ErrorState message={error} /> : null}
        <div ref={bottom} />

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void ask(question);
          }}
          className="sticky bottom-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
        >
          <label htmlFor={inputId} className="sr-only">
            {t("assistant.title")}
          </label>
          <Textarea
            id={inputId}
            value={question}
            rows={2}
            maxLength={2000}
            placeholder={t("assistant.placeholder")}
            disabled={busy}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void ask(question);
              }
            }}
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <FilterChip
                pressed={webSearch}
                disabled={!webSearchAvailable || busy}
                title={webSearchAvailable ? undefined : t("assistant.webUnavailable")}
                onClick={() => onWebSearchChange(!webSearch)}
              >
                {webSearchAvailable ? t("assistant.webSearch") : t("assistant.webUnavailable")}
              </FilterChip>
              <span className="hidden text-xs text-slate-400 sm:inline">{t("capture.shortcutHint", { key: "Ctrl/⌘" })}</span>
            </div>
            <Button type="submit" size="sm" disabled={busy || !question.trim()}>
              {busy ? <Spinner className="border-white/40 border-t-white" /> : <Send className="size-3.5" aria-hidden />}
              {t("assistant.ask")}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
