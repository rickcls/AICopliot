"use client";

import { useId, useState } from "react";
import { Check, Copy, ExternalLink, Mail, PenLine, Trash2 } from "lucide-react";
import { useLocale, useT } from "@/components/i18n-provider";
import { useToast } from "@/components/toast";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  FOCUS_RING,
  Input,
  SectionHeader,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { gmailComposeUrl, mailtoUrl, recipientAddress } from "@/lib/email/links";
import type { EmailDraftView } from "@/lib/email/service";
import { intlLocale } from "@/lib/i18n/locales";
import { cn, formatDay } from "@/lib/utils";

const PURPOSES = ["reply", "follow_up", "update", "request", "thanks", "other"] as const;
type Purpose = (typeof PURPOSES)[number];

export interface EmailTaskOption {
  id: string;
  title: string;
  projectName: string;
}

/**
 * Compose an email in the person's tone, then take it out of the app by hand.
 *
 * The result is editable text, and the only ways out are Copy, Gmail's own
 * compose window, and mailto: — each opened by the person, none sending.
 * Facts in the draft that were not in anything they gave are listed above it,
 * because a confident wrong date is the mistake an email can least afford.
 */
export function EmailComposer({
  tasks,
  initialTaskId,
  initialDrafts,
  initialIncoming = null,
  initialDraft = null,
}: {
  tasks: EmailTaskOption[];
  initialTaskId: string | null;
  initialDrafts: EmailDraftView[];
  /** An email to reply to, from a Gmail capture. */
  initialIncoming?: string | null;
  /** A draft to open straight away, e.g. one the assistant saved. */
  initialDraft?: EmailDraftView | null;
}) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const ids = useId();
  const [purpose, setPurpose] = useState<Purpose>(initialIncoming ? "reply" : "follow_up");
  const [recipient, setRecipient] = useState("");
  const [keyPoints, setKeyPoints] = useState("");
  const [incoming, setIncoming] = useState(initialIncoming ?? "");
  const [taskId, setTaskId] = useState(initialTaskId ?? "");
  const [language, setLanguage] = useState<"auto" | "zh-Hant" | "en">("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState(initialDrafts);
  const [current, setCurrent] = useState<EmailDraftView | null>(initialDraft);
  const [subject, setSubject] = useState(initialDraft?.subject ?? "");
  const [body, setBody] = useState(initialDraft?.body ?? "");
  const [copied, setCopied] = useState(false);

  function show(draft: EmailDraftView) {
    setCurrent(draft);
    setSubject(draft.subject);
    setBody(draft.body);
    setCopied(false);
  }

  async function draft() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/email/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose,
          keyPoints,
          language,
          ...(recipient.trim() ? { recipient: recipient.trim() } : {}),
          ...(incoming.trim() ? { incoming: incoming.trim() } : {}),
          ...(taskId ? { taskId } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.draft) {
        setError(data.error ?? t("email.failed"));
        return;
      }
      setDrafts((list) => [data.draft, ...list].slice(0, 10));
      show(data.draft);
    } catch {
      setError(t("common.couldNotReach"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const response = await fetch(`/api/email/drafts/${id}`, { method: "DELETE" }).catch(() => null);
    if (response?.ok || response?.status === 404) {
      setDrafts((list) => list.filter((item) => item.id !== id));
      if (current?.id === id) setCurrent(null);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(subject ? `${subject}\n\n${body}` : body);
      setCopied(true);
      toast.success(t("email.copied"));
    } catch {
      // Clipboard can be refused; the text stays selectable in the fields.
    }
  }

  const to = recipientAddress(current?.recipient ?? recipient);

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void draft();
          }}
          className="grid gap-3 sm:grid-cols-2"
        >
          <div>
            <label htmlFor={`${ids}-purpose`} className="mb-1 block text-xs font-medium text-slate-500">
              {t("email.purpose")}
            </label>
            <Select
              id={`${ids}-purpose`}
              value={purpose}
              onChange={(event) => setPurpose(event.target.value as Purpose)}
              className="w-full"
            >
              {PURPOSES.map((value) => (
                <option key={value} value={value}>
                  {t(`email.purposes.${value}`)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor={`${ids}-to`} className="mb-1 block text-xs font-medium text-slate-500">
              {t("email.recipient")}
            </label>
            <Input
              id={`${ids}-to`}
              value={recipient}
              maxLength={200}
              placeholder={t("email.recipientPlaceholder")}
              onChange={(event) => setRecipient(event.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${ids}-points`} className="mb-1 block text-xs font-medium text-slate-500">
              {t("email.keyPoints")}
            </label>
            <Textarea
              id={`${ids}-points`}
              value={keyPoints}
              rows={3}
              maxLength={2000}
              placeholder={t("email.keyPointsPlaceholder")}
              onChange={(event) => setKeyPoints(event.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${ids}-incoming`} className="mb-1 block text-xs font-medium text-slate-500">
              {t("email.incoming")}
            </label>
            <Textarea
              id={`${ids}-incoming`}
              value={incoming}
              rows={purpose === "reply" ? 5 : 2}
              maxLength={8000}
              placeholder={t("email.incomingPlaceholder")}
              onChange={(event) => setIncoming(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor={`${ids}-task`} className="mb-1 block text-xs font-medium text-slate-500">
              {t("email.task")}
            </label>
            <Select
              id={`${ids}-task`}
              value={taskId}
              onChange={(event) => setTaskId(event.target.value)}
              className="w-full"
            >
              <option value="">{t("email.noTask")}</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title} · {task.projectName}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor={`${ids}-language`} className="mb-1 block text-xs font-medium text-slate-500">
              {t("email.language")}
            </label>
            <Select
              id={`${ids}-language`}
              value={language}
              onChange={(event) => setLanguage(event.target.value as typeof language)}
              className="w-full"
            >
              <option value="auto">{t("email.languageAuto")}</option>
              <option value="zh-Hant">{t("locale.zhHant")}</option>
              <option value="en">{t("locale.en")}</option>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy || !keyPoints.trim()}>
              {busy ? <Spinner className="border-white/40 border-t-white" /> : <PenLine className="size-4" aria-hidden />}
              {busy ? t("email.drafting") : t("email.draft")}
            </Button>
          </div>
          {error ? (
            <div className="sm:col-span-2">
              <ErrorState message={error} />
            </div>
          ) : null}
        </form>
      </Card>

      {current ? (
        <Card className="space-y-3 p-4">
          {current.flags.length > 0 ? (
            <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p className="text-sm font-medium text-amber-900">{t("email.checkTitle")}</p>
              <p className="mt-0.5 text-xs text-amber-800">{t("email.checkHint")}</p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {current.flags.map((flag) => (
                  <li key={`${flag.kind}:${flag.text}`}>
                    <Badge tone="warning">
                      {t(`email.flagKind.${flag.kind}`)}: {flag.text}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <label htmlFor={`${ids}-subject`} className="mb-1 block text-xs font-medium text-slate-500">
              {t("email.subject")}
            </label>
            <Input id={`${ids}-subject`} value={subject} onChange={(event) => setSubject(event.target.value)} />
          </div>
          <div>
            <label htmlFor={`${ids}-body`} className="mb-1 block text-xs font-medium text-slate-500">
              {t("email.body")}
            </label>
            <Textarea
              id={`${ids}-body`}
              value={body}
              rows={12}
              onChange={(event) => setBody(event.target.value)}
              className="font-sans"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => void copy()}>
              {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              {copied ? t("email.copied") : t("email.copy")}
            </Button>
            <a
              href={gmailComposeUrl({ to, subject, body })}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50",
                FOCUS_RING,
              )}
            >
              <ExternalLink className="size-4" aria-hidden />
              {t("email.openGmail")}
            </a>
            <a
              href={mailtoUrl({ to, subject, body })}
              className={cn(
                "inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                FOCUS_RING,
              )}
            >
              <Mail className="size-4" aria-hidden />
              {t("email.openMail")}
            </a>
            <span className="text-xs text-slate-500">{t("email.neverSent")}</span>
          </div>
        </Card>
      ) : null}

      <section className="space-y-2">
        <SectionHeader title={t("email.recent")} />
        {drafts.length === 0 ? (
          <p className="text-sm text-slate-500">{t("email.noDrafts")}</p>
        ) : (
          <Card className="divide-y divide-slate-100">
            {drafts.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                <button
                  type="button"
                  onClick={() => show(item)}
                  className={cn("min-w-0 flex-1 truncate text-left text-sm font-medium text-slate-900 hover:underline", FOCUS_RING)}
                >
                  {item.subject || item.body.slice(0, 60)}
                </button>
                {item.flags.length > 0 ? <Badge tone="warning">{item.flags.length}</Badge> : null}
                <span className="text-xs text-slate-500">
                  {[t(`email.purposes.${item.purpose as Purpose}`), item.recipient, formatDay(item.createdAt, intlLocale(locale))]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <button
                  type="button"
                  onClick={() => void remove(item.id)}
                  title={t("email.delete")}
                  className={cn("rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-700", FOCUS_RING)}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  <span className="sr-only">{t("email.delete")}</span>
                </button>
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
