"use client";

import { Sparkles, X } from "lucide-react";
import { Button, Spinner } from "@/components/ui";
import type { FillSummary } from "@/components/task-fill-client";
import { fillFieldLabel, type TaskFillField } from "@/lib/pm/task-fill-apply";

function list(fields: TaskFillField[]) {
  const labels = fields.map(fillFieldLabel);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/**
 * Why a fill cannot run yet. A linked document still indexing has no text to
 * read, so the server would refuse; saying so here saves the round trip.
 */
export function fillBlockedReason(
  title: string,
  linked: ReadonlyArray<{ originalFilename: string; status: string }>,
): string | null {
  if (title.trim().length < 3) return "Name the task first.";
  const indexing = linked.find(
    (document) => document.status === "uploaded" || document.status === "processing",
  );
  if (indexing) return `Waiting for ${indexing.originalFilename} to finish indexing.`;
  const failed = linked.find((document) => document.status === "failed");
  if (failed) return `${failed.originalFilename} failed to process. Unlink it or retry it from Documents.`;
  return null;
}

/**
 * The AI fill control and its report.
 *
 * The report is the point: it says which fields were filled, which were left
 * alone because the user had already set them, and quotes the passages the
 * values came from — so reviewing a fill means reading three lines, not
 * re-reading the documents.
 */
export function TaskFillBar({
  blockedReason,
  filling,
  error,
  summary,
  hasLinkedDocuments,
  disabled,
  onFill,
  onRemoveRequirement,
}: {
  /** Why a fill cannot run yet, or null when it can. */
  blockedReason: string | null;
  filling: boolean;
  error: string | null;
  summary: FillSummary | null;
  hasLinkedDocuments: boolean;
  disabled?: boolean;
  onFill: () => void;
  onRemoveRequirement: (requirementId: string) => void;
}) {
  const nothingNew =
    summary !== null &&
    summary.filled.length === 0 &&
    summary.requirements.length === 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onFill}
          disabled={blockedReason !== null || filling || disabled}
        >
          {filling ? (
            <Spinner className="size-3.5" />
          ) : (
            <Sparkles className="size-3.5 text-violet-600" aria-hidden />
          )}
          {filling ? "Reading documents…" : "Fill blanks with AI"}
        </Button>
        <span className="text-xs text-slate-500">
          {blockedReason
            ? blockedReason
            : hasLinkedDocuments
              ? "Reads the linked documents. Only empty fields are filled."
              : "Searches this project's documents. Only empty fields are filled."}
        </span>
      </div>

      {error ? (
        <p role="alert" className="text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}

      {summary ? (
        <div
          role="status"
          className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/60 p-3 text-xs text-slate-700"
        >
          <p>
            {nothingNew ? (
              "The documents had nothing to add to the empty fields."
            ) : summary.filled.length > 0 ? (
              <>
                Filled <strong className="font-semibold">{list(summary.filled)}</strong>{" "}
                from the {summary.evidence === "linked" ? "linked" : "project's"} documents.
                Check them, then save.
              </>
            ) : (
              "Suggested requirement links below. Check them, then save."
            )}
            {summary.kept.length > 0 ? (
              <> Left your {list(summary.kept)} as you set {summary.kept.length === 1 ? "it" : "them"}.</>
            ) : null}
          </p>

          {summary.requirements.length > 0 ? (
            <div>
              <p className="mb-1 font-medium text-slate-500">Delivers</p>
              <ul className="flex flex-wrap gap-1.5">
                {summary.requirements.map((requirement) => (
                  <li
                    key={requirement.id}
                    className="inline-flex max-w-full items-center gap-1 rounded-full bg-white py-0.5 pr-1 pl-2 ring-1 ring-slate-200 ring-inset"
                  >
                    <span className="font-medium text-slate-500">{requirement.code}</span>
                    <span className="truncate">{requirement.title}</span>
                    <button
                      type="button"
                      onClick={() => onRemoveRequirement(requirement.id)}
                      aria-label={`Do not link ${requirement.code}`}
                      className="rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      <X className="size-3" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {summary.sources.length > 0 ? (
            <div>
              <p className="mb-1 font-medium text-slate-500">Sources</p>
              <ul className="space-y-1.5">
                {summary.sources.map((source) => (
                  <li key={source.chunkId}>
                    <span className="font-medium text-slate-800">
                      {source.filename}
                      {source.pageNumber ? ` · p.${source.pageNumber}` : ""}
                    </span>
                    <span className="text-slate-500"> — {list(source.fields)}</span>
                    <p className="mt-0.5 text-slate-600 italic">“{source.excerpt}”</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
