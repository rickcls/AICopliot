"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { AssistantMessage } from "@/components/assistant/assistant-message";
import { BrandMark } from "@/components/brand-mark";
import type { ColleagueOption, ProjectOption } from "@/components/capture/proposal-list";
import { useConfirm } from "@/components/confirm-dialog";
import { useT } from "@/components/i18n-provider";
import { useToast } from "@/components/toast";
import {
  Button,
  ErrorState,
  FilterChip,
  FOCUS_RING,
  LinkButton,
  Spinner,
  Textarea,
} from "@/components/ui";
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
  colleagues,
  webSearchAvailable,
}: {
  threads: ThreadSummary[];
  threadId: string | null;
  messages: AssistantMessageView[];
  projects: ProjectOption[];
  colleagues: ColleagueOption[];
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
      colleagues={colleagues}
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
  colleagues,
  webSearch,
  webSearchAvailable,
  onWebSearchChange,
}: {
  threads: ThreadSummary[];
  threadId: string | null;
  messages: AssistantMessageView[];
  projects: ProjectOption[];
  colleagues: ColleagueOption[];
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
        <LinkButton href="/assistant" variant="secondary" className="w-full justify-start">
          <Plus className="size-4" aria-hidden />
          {t("assistant.newThread")}
        </LinkButton>
        <p className="px-1 pt-3 text-xs font-semibold tracking-wide text-sand-500 uppercase">
          {t("assistant.threads")}
        </p>
        {threads.length === 0 ? (
          <p className="px-1 text-xs text-sand-500">{t("assistant.noThreads")}</p>
        ) : (
          <ul className="space-y-0.5">
            {threads.map((thread) => (
              <li key={thread.id} className="group flex items-center gap-1">
                <Link
                  href={`/assistant?thread=${thread.id}`}
                  aria-current={thread.id === threadId ? "true" : undefined}
                  className={cn(
                    "min-w-0 flex-1 truncate rounded-xl px-2.5 py-1.5 text-sm transition-colors",
                    FOCUS_RING,
                    thread.id === threadId
                      ? "bg-brand-100/70 font-medium text-brand-800"
                      : "text-sand-600 hover:bg-sand-100 hover:text-sand-900",
                  )}
                >
                  {thread.title}
                </Link>
                <button
                  type="button"
                  onClick={() => void removeThread(thread.id)}
                  title={t("assistant.deleteThread")}
                  className={cn("rounded p-1 text-sand-300 hover:text-red-700 sm:opacity-0 sm:group-hover:opacity-100", FOCUS_RING)}
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
          // An invitation rather than a second copy of the page's own heading
          // and lead, which the page header above already shows.
          <div className="flex flex-col items-center px-4 py-12 text-center">
            <BrandMark className="size-12" />
            <h2 className="mt-4 text-xl font-semibold tracking-tight text-sand-900">
              {t("assistant.emptyTitle")}
            </h2>
            <p className="mt-6 text-xs font-semibold tracking-wide text-sand-500 uppercase">
              {t("assistant.tryAsking")}
            </p>
            <div className="mt-3 flex max-w-2xl flex-wrap justify-center gap-2">
              {examples.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => void ask(example)}
                  disabled={busy}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border border-sand-200 bg-white px-3.5 py-1.5 text-sm text-sand-700 shadow-xs transition-colors",
                    "hover:border-brand-200 hover:bg-brand-50 hover:text-brand-800 disabled:opacity-50",
                    FOCUS_RING,
                  )}
                >
                  <Sparkles aria-hidden className="size-3.5 text-brand-500" />
                  {example}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="space-y-6">
            {messages.map((message) => (
              <li key={message.id}>
                {message.role === "user" ? (
                  <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-brand-50 px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-brand-950 ring-1 ring-brand-100 ring-inset">
                    <span className="sr-only">{t("assistant.you")}: </span>
                    {message.content}
                  </div>
                ) : (
                  <AssistantMessage
                    message={message}
                    projects={projects}
                    colleagues={colleagues}
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
          <p className="flex items-center gap-2 text-sm text-sand-500" aria-live="polite">
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
          // One card with a borderless field inside, like the capture box; the
          // card shows focus, so the field drops its own ring.
          className="sticky bottom-4 overflow-hidden rounded-2xl border border-sand-200/80 bg-white shadow-soft transition-shadow focus-within:border-brand-300 focus-within:ring-4 focus-within:ring-brand-100/70"
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
            className="resize-none rounded-none border-0 bg-transparent px-4 pt-3 pb-1 text-[15px] leading-relaxed focus-visible:ring-0 focus-visible:ring-offset-0"
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void ask(question);
              }
            }}
          />
          <div className="flex items-center justify-between gap-3 px-3 pt-1 pb-3">
            <div className="flex min-w-0 items-center gap-2">
              <FilterChip
                pressed={webSearch}
                disabled={!webSearchAvailable || busy}
                title={webSearchAvailable ? undefined : t("assistant.webUnavailable")}
                onClick={() => onWebSearchChange(!webSearch)}
              >
                {webSearchAvailable ? t("assistant.webSearch") : t("assistant.webUnavailable")}
              </FilterChip>
              <span className="hidden text-xs text-sand-400 sm:inline">{t("capture.shortcutHint", { key: "Ctrl/⌘" })}</span>
            </div>
            <Button type="submit" size="sm" disabled={busy || !question.trim()}>
              {busy ? <Spinner inverse /> : <Send className="size-3.5" aria-hidden />}
              {t("assistant.ask")}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
