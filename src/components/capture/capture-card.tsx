"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText, Trash2 } from "lucide-react";
import {
  ProposalList,
  type ColleagueOption,
  type ProjectOption,
} from "@/components/capture/proposal-list";
import { useConfirm } from "@/components/confirm-dialog";
import { useLocale, useT } from "@/components/i18n-provider";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, ErrorState, FOCUS_RING, Spinner } from "@/components/ui";
import type { CaptureView } from "@/lib/capture/view";
import { intlLocale } from "@/lib/i18n/locales";
import { cn, formatDay } from "@/lib/utils";

export type { ProjectOption };

const SOURCE_KEY = {
  text: "capture.sourceText",
  voice: "capture.sourceVoice",
  document: "capture.sourceDocument",
  email: "capture.sourceEmail",
  whatsapp: "capture.sourceWhatsApp",
} as const;

/**
 * One captured note and the changes it suggests. The suggestions themselves
 * render through `ProposalList`, shared with the assistant.
 */
export function CaptureCard({
  capture,
  projects,
  colleagues,
  onChange,
  onDelete,
}: {
  capture: CaptureView;
  projects: ProjectOption[];
  colleagues: ColleagueOption[];
  onChange: (capture: CaptureView) => void;
  onDelete: (captureId: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [showNote, setShowNote] = useState(false);

  const dateLocale = intlLocale(locale);
  const pending = capture.proposals.filter((proposal) => proposal.state === "pending");

  async function retry() {
    setBusy("retry");
    try {
      const response = await fetch(`/api/captures/${capture.id}/retry`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (data.capture) onChange(data.capture as CaptureView);
      else toast.error(data.error ?? t("capture.sendFailed"));
    } catch {
      toast.error(t("common.couldNotReach"));
    } finally {
      setBusy(null);
    }
  }

  /** The whole capture comes back: the correction is now part of the note. */
  async function revise(proposalId: string, instruction: string) {
    try {
      const response = await fetch(`/api/capture-proposals/${proposalId}/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.capture) {
        toast.error(t("capture.reviseFailed"), data.error);
        return false;
      }
      onChange(data.capture as CaptureView);
      toast.success(t("capture.revised"));
      return true;
    } catch {
      toast.error(t("common.couldNotReach"));
      return false;
    }
  }

  async function saveAsDocument() {
    const ok = await confirm({
      title: t("capture.saveTitle"),
      body: t("capture.saveBody"),
      confirmLabel: t("capture.saveAsDocument"),
    });
    if (!ok) return;
    setBusy("save");
    try {
      const response = await fetch(`/api/captures/${capture.id}/save-document`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.documentId) {
        toast.error(t("capture.saveDocumentFailed"), data.error);
        return;
      }
      onChange({ ...capture, documentId: data.documentId });
      toast.success(t("capture.savedToast"));
    } catch {
      toast.error(t("common.couldNotReach"));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: t("capture.deleteTitle"),
      body: t("capture.deleteBody"),
      confirmLabel: t("capture.delete"),
      tone: "danger",
    });
    if (!ok) return;
    const response = await fetch(`/api/captures/${capture.id}`, { method: "DELETE" });
    if (response.ok || response.status === 404) onDelete(capture.id);
    else toast.error(t("common.couldNotReach"));
  }

  const sourceLabel =
    capture.source === "document"
      ? t(SOURCE_KEY.document, { name: capture.documentName ?? "" })
      : t(SOURCE_KEY[capture.source]);

  return (
    <Card id={`capture-${capture.id}`} className="scroll-mt-24 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-2.5">
        <span className="text-xs text-slate-500">
          {/* The capture's own calendar day, UTC-pinned: a clock time here
              would render in the server's zone, then the browser's. */}
          {formatDay(capture.localDate, dateLocale)}
          <span className="mx-1.5 text-slate-300">·</span>
          {sourceLabel}
        </span>
        {pending.length > 0 ? (
          <Badge tone="info">{t("capture.pendingCount", { count: pending.length })}</Badge>
        ) : null}
        <span className="flex-1" />
        {capture.source === "email" ? (
          <Link
            href={`/email?capture=${capture.id}`}
            className="text-xs font-medium text-slate-500 hover:text-slate-900"
          >
            {t("capture.replyToEmail")}
          </Link>
        ) : null}
        {capture.documentId ? (
          <Link
            href={`/documents/${capture.documentId}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900"
          >
            <FileText className="size-3.5" aria-hidden />
            {t("capture.openDocument")}
          </Link>
        ) : capture.status !== "processing" ? (
          <button
            type="button"
            disabled={busy === "save"}
            onClick={() => void saveAsDocument()}
            className={cn("text-xs font-medium text-slate-500 hover:text-slate-900 disabled:opacity-50", FOCUS_RING)}
          >
            {t("capture.saveAsDocument")}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setShowNote(!showNote)}
          aria-expanded={showNote}
          className={cn("text-xs font-medium text-slate-500 hover:text-slate-900", FOCUS_RING)}
        >
          {showNote ? t("capture.hideNote") : t("capture.showNote")}
        </button>
        <button
          type="button"
          onClick={() => void remove()}
          title={t("capture.delete")}
          className={cn("rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-700", FOCUS_RING)}
        >
          <Trash2 className="size-3.5" aria-hidden />
          <span className="sr-only">{t("capture.delete")}</span>
        </button>
      </div>

      {showNote ? (
        <p className="border-b border-slate-100 bg-slate-50 px-4 py-3 text-sm whitespace-pre-wrap text-slate-700">
          {capture.body}
        </p>
      ) : null}

      {capture.status === "failed" ? (
        <div className="space-y-3 p-4">
          <ErrorState message={`${t("capture.failedTitle")}: ${capture.errorMessage ?? ""}`} />
          <Button type="button" size="sm" disabled={busy === "retry"} onClick={() => void retry()}>
            {busy === "retry" ? <Spinner className="border-white/40 border-t-white" /> : null}
            {t("capture.retry")}
          </Button>
        </div>
      ) : capture.status === "processing" ? (
        <p className="flex items-center gap-2 p-4 text-sm text-slate-500">
          <Spinner /> {t("capture.submitting")}
        </p>
      ) : capture.proposals.length === 0 ? (
        <p className="p-4 text-sm text-slate-500">{t("capture.noSuggestions")}</p>
      ) : (
        <ProposalList
          proposals={capture.proposals}
          projects={projects}
          colleagues={colleagues}
          applyUrl={`/api/captures/${capture.id}/apply`}
          decideUrl={(id) => `/api/capture-proposals/${id}`}
          readProposals={(data) =>
            (data as { capture?: CaptureView | null }).capture?.proposals ?? null
          }
          onChange={(proposals) => onChange({ ...capture, proposals })}
          onRevise={revise}
          notice={
            capture.source === "email" &&
            !capture.documentId &&
            pending.some((proposal) => proposal.kind === "create_task")
              ? t("capture.emailAttachNotice")
              : null
          }
          // The capture as the server now has it — after the first task from an
          // email, that includes the document the email was saved as.
          onApplied={(data) => {
            const next = (data as { capture?: CaptureView | null }).capture;
            if (next) onChange(next);
          }}
        />
      )}
    </Card>
  );
}
