"use client";

import { Sparkles, X } from "lucide-react";
import { useDateLocale, useT } from "@/components/i18n-provider";
import { Button, Spinner } from "@/components/ui";
import type { FillSummary } from "@/components/task-fill-client";
import { documentName } from "@/lib/documents/name";
import type { Translate } from "@/lib/i18n/translate";
import type { TaskFillField } from "@/lib/pm/task-fill-apply";

/**
 * Why a fill cannot run yet. A linked document still indexing has no text to
 * read, so the server would refuse; saying so here saves the round trip.
 */
export function fillBlockedReason(
  title: string,
  linked: ReadonlyArray<{ originalFilename: string; title: string | null; status: string }>,
  t: Translate,
): string | null {
  if (title.trim().length < 3) return t("tasks.fill.nameFirst");
  const indexing = linked.find(
    (document) => document.status === "uploaded" || document.status === "processing",
  );
  if (indexing) return t("tasks.fill.indexing", { filename: documentName(indexing) });
  const failed = linked.find((document) => document.status === "failed");
  if (failed) return t("tasks.fill.failed", { filename: documentName(failed) });
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
  const t = useT();
  const dateLocale = useDateLocale();
  // "description, priority and due date" in English, 「描述、優先度和到期日」 in Chinese.
  const list = (fields: TaskFillField[]) =>
    new Intl.ListFormat(dateLocale, { type: "conjunction" }).format(
      fields.map((field) => t(`tasks.fill.fieldNames.${field}`)),
    );
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
          {filling ? t("tasks.fill.reading") : t("tasks.fill.button")}
        </Button>
        <span className="text-xs text-sand-500">
          {blockedReason
            ? blockedReason
            : hasLinkedDocuments
              ? t("tasks.fill.readsLinked")
              : t("tasks.fill.searchesProject")}
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
          className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/60 p-3 text-xs text-sand-700"
        >
          <p>
            {nothingNew
              ? t("tasks.fill.nothingNew")
              : summary.filled.length > 0
                ? t(
                    summary.evidence === "linked"
                      ? "tasks.fill.filledLinked"
                      : "tasks.fill.filledProject",
                    { fields: list(summary.filled) },
                  )
                : t("tasks.fill.suggestedOnly")}
            {summary.kept.length > 0
              ? ` ${t("tasks.fill.kept", { count: summary.kept.length, fields: list(summary.kept) })}`
              : null}
          </p>

          {summary.requirements.length > 0 ? (
            <div>
              <p className="mb-1 font-medium text-sand-500">{t("tasks.detail.delivers")}</p>
              <ul className="flex flex-wrap gap-1.5">
                {summary.requirements.map((requirement) => (
                  <li
                    key={requirement.id}
                    className="inline-flex max-w-full items-center gap-1 rounded-full bg-white py-0.5 pr-1 pl-2 ring-1 ring-sand-200 ring-inset"
                  >
                    <span className="font-medium text-sand-500">{requirement.code}</span>
                    <span className="truncate">{requirement.title}</span>
                    <button
                      type="button"
                      onClick={() => onRemoveRequirement(requirement.id)}
                      aria-label={t("tasks.fill.doNotLink", { code: requirement.code })}
                      className="rounded-full p-0.5 text-sand-400 hover:bg-sand-100 hover:text-sand-700"
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
              <p className="mb-1 font-medium text-sand-500">{t("tasks.detail.sources")}</p>
              <ul className="space-y-1.5">
                {summary.sources.map((source) => (
                  <li key={source.chunkId}>
                    <span className="font-medium text-sand-800">
                      {source.filename}
                      {source.pageNumber
                        ? ` · ${t("common.page", { page: source.pageNumber })}`
                        : ""}
                    </span>
                    <span className="text-sand-500"> — {list(source.fields)}</span>
                    <p className="mt-0.5 text-sand-600 italic">“{source.excerpt}”</p>
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
