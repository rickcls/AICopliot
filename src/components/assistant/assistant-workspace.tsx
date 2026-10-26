"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Files, FolderKanban, Library, Paperclip, Plus, Send, Sparkles, Trash2, X } from "lucide-react";
import { AssistantMessage } from "@/components/assistant/assistant-message";
import { BrandMark } from "@/components/brand-mark";
import type { ColleagueOption, ProjectOption } from "@/components/capture/proposal-list";
import { DocumentChooser } from "@/components/chat/document-chooser";
import { useConfirm } from "@/components/confirm-dialog";
import { useT } from "@/components/i18n-provider";
import { PillSelect } from "@/components/property-pill";
import { projectOptions } from "@/components/task-field-options";
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
import type { AskContext, AssistantMessageView } from "@/lib/assistant/service";
import { documentName } from "@/lib/documents/name";
import { uploadAllAndIndex, uploadFailureMessage } from "@/lib/documents/upload";
import { UPLOAD_EXTENSIONS } from "@/lib/mail/document";
import { MAX_FOCUS_DOCUMENTS } from "@/lib/schemas";
import { cn } from "@/lib/utils";

type Attachment = AskContext["documents"][number];

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
  // thread and remounts the conversation) does not snap the switch back off —
  // and the project and attachments a question is asked about stay as set.
  const [webSearch, setWebSearch] = useState(false);
  const [askProjectId, setAskProjectId] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
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
      askProjectId={askProjectId}
      onAskProjectChange={setAskProjectId}
      attachments={attachments}
      onAttachmentsChange={setAttachments}
    />
  );
}

/** What a question was asked about, under the person's message. */
function AskContextLine({ context }: { context: AskContext }) {
  return (
    <div className="mt-1.5 flex flex-wrap justify-end gap-1.5 text-xs text-sand-500">
      {context.project ? (
        <span className="inline-flex items-center gap-1">
          <FolderKanban aria-hidden className="size-3.5" />
          {context.project.name}
        </span>
      ) : null}
      {context.documents.map((document) => (
        <span key={document.id} className="inline-flex max-w-[16rem] items-center gap-1">
          <FileText aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{document.name}</span>
        </span>
      ))}
    </div>
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
  askProjectId,
  onAskProjectChange,
  attachments,
  onAttachmentsChange,
}: {
  threads: ThreadSummary[];
  threadId: string | null;
  messages: AssistantMessageView[];
  projects: ProjectOption[];
  colleagues: ColleagueOption[];
  webSearch: boolean;
  webSearchAvailable: boolean;
  onWebSearchChange: (on: boolean) => void;
  /** "" asks about everything; otherwise documents, tasks, and new tasks stay in it. */
  askProjectId: string;
  onAskProjectChange: (projectId: string) => void;
  /** Documents the answer comes from, attached or chosen. */
  attachments: Attachment[];
  onAttachmentsChange: (attachments: Attachment[]) => void;
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
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number; name: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [choosing, setChoosing] = useState<{ id: string; filename: string }[] | null>(null);

  const askProject = projects.find((project) => project.id === askProjectId) ?? null;

  function addAttachments(added: Attachment[]) {
    const known = new Set(attachments.map((attachment) => attachment.id));
    onAttachmentsChange(
      [...attachments, ...added.filter((attachment) => !known.has(attachment.id))].slice(0, MAX_FOCUS_DOCUMENTS),
    );
  }

  /**
   * Files go into the project the question is about, or the person's own
   * project, as ordinary documents — then the answer comes from them.
   */
  async function attachFiles(files: File[]) {
    const target = askProject ?? projects.find((project) => project.personal) ?? null;
    if (files.length === 0 || uploading || !target) return;
    setError(null);
    const results = await uploadAllAndIndex(files.slice(0, MAX_FOCUS_DOCUMENTS), target.id, (done, total, name) =>
      setUploading(name ? { done: done + 1, total, name } : null),
    );
    setUploading(null);
    if (fileInput.current) fileInput.current.value = "";
    const added = results.flatMap((result) => (result.ok ? [{ id: result.id, name: result.name }] : []));
    if (added.length > 0) {
      addAttachments(added);
      toast.success(t("assistant.uploadedTo", { project: target.name }));
    }
    const failures = results.flatMap((result) => (result.ok ? [] : [uploadFailureMessage(result, t)]));
    if (failures.length > 0) setError(failures.join("\n"));
  }

  /** Lists the indexed documents the question could be pinned to, when asked. */
  async function openChooser() {
    setError(null);
    const response = await fetch(
      askProjectId ? `/api/documents?projectId=${encodeURIComponent(askProjectId)}` : "/api/documents",
    ).catch(() => null);
    const data = (await response?.json().catch(() => null)) as {
      documents?: { id: string; originalFilename: string; title: string | null; status: string }[];
    } | null;
    if (!response?.ok || !data?.documents) {
      setError(t("common.couldNotReach"));
      return;
    }
    setChoosing(
      data.documents
        .filter((document) => document.status === "ready")
        .map((document) => ({ id: document.id, filename: documentName(document) })),
    );
  }

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
      context:
        askProject || attachments.length
          ? { project: askProject ? { id: askProject.id, name: askProject.name } : null, documents: attachments }
          : null,
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
          ...(askProjectId ? { projectId: askProjectId } : {}),
          ...(attachments.length ? { documentIds: attachments.map((attachment) => attachment.id) } : {}),
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
                  <div className="ml-auto w-fit max-w-[85%]">
                    <div className="rounded-2xl rounded-br-md bg-brand-50 px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-brand-950 ring-1 ring-brand-100 ring-inset">
                      <span className="sr-only">{t("assistant.you")}: </span>
                      {message.content}
                    </div>
                    {message.context ? <AskContextLine context={message.context} /> : null}
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
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            if (!event.dataTransfer.files.length) return;
            event.preventDefault();
            setDragging(false);
            void attachFiles([...event.dataTransfer.files]);
          }}
          // One card with a borderless field inside, like the capture box; the
          // card shows focus, so the field drops its own ring.
          className={cn(
            "sticky bottom-4 overflow-hidden rounded-2xl border border-sand-200/80 bg-white shadow-soft transition-shadow focus-within:border-brand-300 focus-within:ring-4 focus-within:ring-brand-100/70",
            dragging && "border-brand-300 ring-4 ring-brand-100/70",
          )}
        >
          {attachments.length > 0 || uploading || dragging ? (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-sand-100 px-3 py-2">
              {dragging ? <span className="text-xs text-brand-700">{t("assistant.dropHere")}</span> : null}
              {attachments.map((attachment) => (
                <span
                  key={attachment.id}
                  className="inline-flex max-w-[16rem] items-center gap-1 rounded-full bg-sand-100 py-0.5 pr-1 pl-2.5 text-xs text-sand-700"
                >
                  <FileText aria-hidden className="size-3.5 shrink-0 text-sand-400" />
                  <span className="truncate">{attachment.name}</span>
                  <button
                    type="button"
                    onClick={() => onAttachmentsChange(attachments.filter((row) => row.id !== attachment.id))}
                    aria-label={t("assistant.removeAttachment", { name: attachment.name })}
                    className={cn("rounded-full p-0.5 text-sand-400 hover:bg-sand-200 hover:text-sand-700", FOCUS_RING)}
                  >
                    <X aria-hidden className="size-3" />
                  </button>
                </span>
              ))}
              {uploading ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-sand-500" aria-live="polite">
                  <Spinner className="size-3" />
                  {t("assistant.uploading", uploading)}
                </span>
              ) : attachments.length > 0 ? (
                <span className="text-xs text-sand-400">{t("assistant.attached")}</span>
              ) : null}
            </div>
          ) : null}
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
            {/* Wraps at phone width rather than pushing the page sideways. */}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span id={`${inputId}-project-label`} className="sr-only">
                {t("assistant.askAbout")}
              </span>
              <PillSelect
                id={`${inputId}-project`}
                icon={<FolderKanban className="size-3.5 opacity-70" />}
                value={askProjectId}
                options={[
                  {
                    value: "",
                    label: t("assistant.allProjects"),
                    content: (
                      <>
                        <Library aria-hidden className="size-4 shrink-0 text-sand-400" />
                        <span className="truncate">{t("assistant.allProjects")}</span>
                      </>
                    ),
                  },
                  ...projectOptions(projects),
                ]}
                onValueChange={onAskProjectChange}
                disabled={busy}
                className="h-7 max-w-[14rem] shrink text-xs"
              />
              <input
                ref={fileInput}
                type="file"
                multiple
                className="sr-only"
                tabIndex={-1}
                accept={UPLOAD_EXTENSIONS.join(",")}
                onChange={(event) => void attachFiles([...(event.target.files ?? [])])}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy || uploading !== null}
                onClick={() => fileInput.current?.click()}
              >
                <Paperclip className="size-3.5" aria-hidden />
                {t("assistant.attach")}
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void openChooser()}>
                <Files className="size-3.5" aria-hidden />
                {t("assistant.chooseDocuments")}
              </Button>
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
            <Button type="submit" size="sm" disabled={busy || uploading !== null || !question.trim()}>
              {busy ? <Spinner inverse /> : <Send className="size-3.5" aria-hidden />}
              {t("assistant.ask")}
            </Button>
          </div>
        </form>
      </section>

      {choosing ? (
        <DocumentChooser
          documents={choosing}
          initial={attachments.map((attachment) => attachment.id)}
          onCancel={() => setChoosing(null)}
          onChoose={(ids) => {
            const names = new Map([
              ...attachments.map((attachment) => [attachment.id, attachment.name] as const),
              ...choosing.map((document) => [document.id, document.filename] as const),
            ]);
            onAttachmentsChange(ids.map((id) => ({ id, name: names.get(id) ?? "" })));
            setChoosing(null);
          }}
        />
      ) : null}
    </div>
  );
}
