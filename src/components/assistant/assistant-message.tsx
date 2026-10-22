"use client";

import { useState } from "react";
import Link from "next/link";
import { BookOpen, Check, Copy, ExternalLink, Lightbulb, Mail, Search } from "lucide-react";
import { AnswerText, sourceHref } from "@/components/assistant/answer-text";
import {
  ProposalList,
  type ColleagueOption,
  type ProjectOption,
} from "@/components/capture/proposal-list";
import { BrandMark } from "@/components/brand-mark";
import { useT } from "@/components/i18n-provider";
import { Badge, Card, FOCUS_RING } from "@/components/ui";
import type { AssistantMessageView } from "@/lib/assistant/service";
import { gmailComposeUrl, recipientAddress } from "@/lib/email/links";
import type { MessageKey } from "@/lib/i18n/translate";
import { cn } from "@/lib/utils";

/**
 * One assistant turn: the answer with its sources linked, a plain marker when
 * any of it is general knowledge, what was looked up, any email drafts it
 * saved (never sent), and the changes it suggests — which apply only through
 * the same Apply as a capture's.
 */
export function AssistantMessage({
  message,
  projects,
  colleagues,
  onChange,
}: {
  message: AssistantMessageView;
  projects: ProjectOption[];
  colleagues: ColleagueOption[];
  onChange: (message: AssistantMessageView) => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
    } catch {
      // Clipboard refused; the draft is still open on the Email page.
    }
  }

  return (
    // The assistant wears the app's own mark, as it does in Ask documents.
    <div className="flex gap-3">
      <BrandMark className="mt-0.5 size-7" />
      <div className="min-w-0 flex-1 space-y-3">
        <AnswerText content={message.content} sources={message.sources} />

        {message.general ? (
          <p className="inline-flex items-center gap-1 text-xs font-medium text-violet-700">
            <Lightbulb className="size-3" aria-hidden />
            {t("assistant.general")}
          </p>
        ) : null}

        {message.steps.length > 0 ? (
          <details className="text-xs text-sand-500">
            <summary className={cn("cursor-pointer select-none hover:text-sand-800", FOCUS_RING)}>
              <Search className="mr-1 inline size-3" aria-hidden />
              {t("assistant.steps")} ({message.steps.length})
            </summary>
            <ul className="mt-1.5 space-y-0.5 pl-4">
              {message.steps.map((step, index) => (
                <li key={index}>
                  {t(`assistant.tool.${step.tool}` as MessageKey)}
                  {step.input ? <span className="text-sand-400"> · {step.input}</span> : null}
                  <span className="text-sand-400"> → {step.summary}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {message.sources.some((source) => source.kind === "document") ? (
          <div className="flex flex-wrap gap-1.5">
            {message.sources
              .filter((source) => source.kind === "document")
              .map((source) =>
                source.kind === "document" ? (
                  <Link
                    key={source.label}
                    href={sourceHref(source)}
                    title={source.excerpt}
                    className="inline-flex items-center gap-1 rounded-md bg-sand-100 px-1.5 py-0.5 text-xs text-sand-700 hover:bg-sand-200"
                  >
                    <BookOpen className="size-3" aria-hidden />
                    <span className="font-mono text-[11px] text-sand-500">{source.label}</span>
                    <span className="max-w-48 truncate">{source.filename}</span>
                  </Link>
                ) : null,
              )}
          </div>
        ) : null}

        {message.sources.some((source) => source.kind === "web") ? (
          <div className="flex flex-wrap gap-1.5">
            {message.sources
              .filter((source) => source.kind === "web")
              .map((source) =>
                source.kind === "web" ? (
                  <a
                    key={source.label}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={source.excerpt}
                    className="inline-flex items-center gap-1 rounded-md bg-sand-100 px-1.5 py-0.5 text-xs text-sand-700 hover:bg-sand-200"
                  >
                    <ExternalLink className="size-3" aria-hidden />
                    <span className="font-mono text-[11px] text-sand-500">{source.label}</span>
                    <span className="max-w-48 truncate">{source.title}</span>
                  </a>
                ) : null,
              )}
          </div>
        ) : null}

        {message.drafts.map((draft) => (
          <Card key={draft.id} className="space-y-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Mail className="size-4 text-sand-400" aria-hidden />
              <span className="text-xs font-medium text-sand-500">{t("assistant.draft")}</span>
              {draft.flags.length > 0 ? <Badge tone="warning">{t("email.checkTitle")}: {draft.flags.length}</Badge> : null}
            </div>
            <p className="text-sm font-medium text-sand-900">{draft.subject}</p>
            <p className="line-clamp-6 text-sm whitespace-pre-wrap text-sand-700">{draft.body}</p>
            <div className="flex flex-wrap items-center gap-3 text-xs font-medium">
              <button
                type="button"
                onClick={() => void copy(draft.id, `${draft.subject}\n\n${draft.body}`)}
                className={cn("inline-flex items-center gap-1 text-sand-600 hover:text-sand-900", FOCUS_RING)}
              >
                {copied === draft.id ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                {copied === draft.id ? t("email.copied") : t("email.copy")}
              </button>
              <a
                href={gmailComposeUrl({ to: recipientAddress(draft.recipient), subject: draft.subject, body: draft.body })}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sand-600 hover:text-sand-900"
              >
                <ExternalLink className="size-3.5" aria-hidden />
                {t("email.openGmail")}
              </a>
              <Link href={`/email?draft=${draft.id}`} className="text-sand-600 hover:text-sand-900">
                {t("assistant.openDraft")}
              </Link>
            </div>
          </Card>
        ))}

        {message.proposals.length > 0 ? (
          <Card className="overflow-hidden">
            <p className="border-b border-sand-100 px-4 py-2 text-xs font-medium text-sand-500">
              {t("assistant.suggestions")}
            </p>
            <ProposalList
              proposals={message.proposals}
              projects={projects}
              colleagues={colleagues}
              applyUrl={`/api/assistant/messages/${message.id}/apply`}
              decideUrl={(id) => `/api/assistant-proposals/${id}`}
              readProposals={(data) =>
                (data as { message?: AssistantMessageView | null }).message?.proposals ?? null
              }
              onChange={(proposals) => onChange({ ...message, proposals })}
            />
          </Card>
        ) : null}
      </div>
    </div>
  );
}
