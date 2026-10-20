"use client";

import Link from "next/link";
import { useDateLocale, useT, useTimeZone } from "@/components/i18n-provider";
import { Badge } from "@/components/ui";
import { labelOr } from "@/lib/i18n/translate";
import type { Citation } from "@/lib/schemas";
import { formatDate } from "@/lib/utils";
import { sourceAnchorId } from "./answer-body";

/**
 * One piece of evidence behind an answer.
 *
 * Live project records and document chunks are visually distinct because they
 * answer different questions — what the client asked for versus what is true
 * right now — and only the live ones carry an observation time.
 *
 * The monospace label at the row start is what the inline chip in the answer
 * jumps to, so the two visibly correspond rather than the reader having to guess
 * which card `[T3]` meant.
 */
function LabelChip({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded border border-slate-300 bg-white px-1 font-mono text-[10px] font-medium text-slate-500">
      {label}
    </span>
  );
}

export function SourceCard({
  citation,
  messageId,
}: {
  citation: Citation;
  messageId: string;
}) {
  const t = useT();
  const dateLocale = useDateLocale();
  const timeZone = useTimeZone();
  // Cards for citations written before labels existed still render; they just
  // have nothing to jump to, which matches the answer text leaving them literal.
  const anchorId = citation.label
    ? sourceAnchorId(messageId, citation.label)
    : undefined;

  if (citation.kind !== "document") {
    // A frozen snapshot's status is an enum value for milestones, risks, and
    // requirements, and a column label (data) for tasks.
    const rawStatus =
      typeof citation.snapshot.status === "string" ? citation.snapshot.status : null;
    const statusFamily =
      citation.kind === "milestone"
        ? "milestoneStatus"
        : citation.kind === "risk"
          ? "riskStatus"
          : citation.kind === "requirement"
            ? "requirementStatus"
            : null;
    const status = rawStatus
      ? statusFamily
        ? labelOr(t, `${statusFamily}.${rawStatus}`, rawStatus.replaceAll("_", " "))
        : rawStatus.replaceAll("_", " ")
      : null;
    const sourceDate =
      typeof citation.snapshot.dueDate === "string"
        ? citation.snapshot.dueDate
        : typeof citation.snapshot.targetDate === "string"
          ? citation.snapshot.targetDate
          : null;
    const label = t(`chat.source.kinds.${citation.kind}`);
    // A note is someone's report, so who wrote it and when sit beside it.
    const writtenBy =
      citation.kind === "note" &&
      typeof citation.snapshot.author === "string" &&
      typeof citation.snapshot.writtenAt === "string"
        ? `${citation.snapshot.author} · ${formatDate(citation.snapshot.writtenAt, dateLocale, timeZone)}`
        : null;

    return (
      <div
        id={anchorId}
        className="scroll-mt-24 rounded-lg border border-blue-200 bg-blue-50/50 p-3 transition-shadow"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {citation.label ? <LabelChip label={citation.label} /> : null}
          <Badge tone="info">{label}</Badge>
          <Link
            href={citation.href}
            className="text-xs font-medium text-slate-900 hover:underline"
          >
            {citation.title}
          </Link>
          {status ? <span className="text-xs text-slate-500">{status}</span> : null}
          {sourceDate ? (
            <span className="text-xs text-slate-500">{sourceDate}</span>
          ) : null}
          {writtenBy ? <span className="text-xs text-slate-500">{writtenBy}</span> : null}
          <span className="ml-auto text-xs text-slate-400">
            {t("chat.source.observed", { date: formatDate(citation.observedAt, dateLocale, timeZone) })}
          </span>
        </div>
        <blockquote className="mt-2 border-l-2 border-blue-300 pl-3 text-xs text-pretty text-slate-600 italic">
          {citation.excerpt}
        </blockquote>
      </div>
    );
  }

  const location = [
    citation.pageNumber !== null ? t("chat.source.page", { page: citation.pageNumber }) : null,
    citation.sectionTitle,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      id={anchorId}
      className="scroll-mt-24 rounded-lg border border-slate-200 bg-slate-50/60 p-3 transition-shadow"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {citation.label ? <LabelChip label={citation.label} /> : null}
        <Link
          // Opens the cited passage itself, not the top of the document.
          href={`/documents/${citation.documentId}/chunks?chunk=${citation.chunkId}#chunk-${citation.chunkId}`}
          className="text-xs font-medium text-slate-900 hover:underline"
        >
          {citation.filename}
        </Link>
        {location ? (
          <span className="text-xs text-slate-500">{location}</span>
        ) : null}
        <span className="ml-auto text-xs text-slate-400">
          {citation.matchType === "lexical"
            ? t("chat.source.lexical")
            : citation.matchType === "hybrid"
              ? t("chat.source.hybrid", { percent: (citation.score * 100).toFixed(0) })
              : t("chat.source.semantic", { percent: (citation.score * 100).toFixed(0) })}
        </span>
      </div>
      <blockquote className="mt-2 border-l-2 border-slate-300 pl-3 text-xs text-pretty text-slate-600 italic">
        {citation.excerpt}
      </blockquote>
    </div>
  );
}
