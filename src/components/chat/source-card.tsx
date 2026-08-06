"use client";

import Link from "next/link";
import { Badge } from "@/components/ui";
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
  // Cards for citations written before labels existed still render; they just
  // have nothing to jump to, which matches the answer text leaving them literal.
  const anchorId = citation.label
    ? sourceAnchorId(messageId, citation.label)
    : undefined;

  if (citation.kind !== "document") {
    const status =
      typeof citation.snapshot.status === "string"
        ? citation.snapshot.status.replaceAll("_", " ")
        : null;
    const sourceDate =
      typeof citation.snapshot.dueDate === "string"
        ? citation.snapshot.dueDate
        : typeof citation.snapshot.targetDate === "string"
          ? citation.snapshot.targetDate
          : null;
    const label =
      citation.kind === "project_snapshot"
        ? "Project snapshot"
        : citation.kind.charAt(0).toUpperCase() + citation.kind.slice(1);

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
          <span className="ml-auto text-xs text-slate-400">
            observed {formatDate(citation.observedAt)}
          </span>
        </div>
        <blockquote className="mt-2 border-l-2 border-blue-300 pl-3 text-xs text-pretty text-slate-600 italic">
          {citation.excerpt}
        </blockquote>
      </div>
    );
  }

  const location = [
    citation.pageNumber !== null ? `page ${citation.pageNumber}` : null,
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
          href={`/documents/${citation.documentId}`}
          className="text-xs font-medium text-slate-900 hover:underline"
        >
          {citation.filename}
        </Link>
        {location ? (
          <span className="text-xs text-slate-500">{location}</span>
        ) : null}
        <span className="ml-auto text-xs text-slate-400">
          {citation.matchType === "lexical"
            ? "exact text match"
            : citation.matchType === "hybrid"
              ? `hybrid · ${(citation.score * 100).toFixed(0)}% semantic`
              : `${(citation.score * 100).toFixed(0)}% semantic match`}
        </span>
      </div>
      <blockquote className="mt-2 border-l-2 border-slate-300 pl-3 text-xs text-pretty text-slate-600 italic">
        {citation.excerpt}
      </blockquote>
    </div>
  );
}
