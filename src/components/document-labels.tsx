"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, Input, Select, Spinner } from "@/components/ui";
import type { MessageKey } from "@/lib/i18n/translate";

const DOC_TYPES = [
  "contract",
  "proposal",
  "quotation",
  "invoice",
  "report",
  "minutes",
  "email",
  "specification",
  "policy",
  "plan",
  "presentation",
  "form",
  "other",
] as const;

/**
 * A document's filing labels: shown, edited by hand, or (re)written by the
 * assistant. Editing marks them as the person's own, and a later AI pass then
 * leaves the title, type, and tags alone — it only refreshes the summary.
 */
export function DocumentLabels({
  documentId,
  ready,
  title,
  docType,
  tags,
  labelSource,
}: {
  documentId: string;
  ready: boolean;
  title: string | null;
  docType: string | null;
  tags: string[];
  labelSource: string | null;
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const ids = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: title ?? "", docType: docType ?? "", tags: tags.join(", ") });
  const [busy, setBusy] = useState<"save" | "label" | null>(null);

  async function save() {
    setBusy("save");
    try {
      const response = await fetch(`/api/documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title.trim() || null,
          docType: draft.docType || null,
          tags: draft.tags
            .split(/[,，、]/)
            .map((tag) => tag.trim().replace(/^#/, ""))
            .filter(Boolean)
            .slice(0, 6),
        }),
      });
      if (!response.ok) {
        toast.error(t("documents.detail.saveFailed"));
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      toast.error(t("common.couldNotReach"));
    } finally {
      setBusy(null);
    }
  }

  async function relabel() {
    setBusy("label");
    try {
      const response = await fetch(`/api/documents/${documentId}/label`, { method: "POST" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        toast.error(t("documents.labelFailed", { name: title ?? "" }), data.error);
        return;
      }
      router.refresh();
    } catch {
      toast.error(t("common.couldNotReach"));
    } finally {
      setBusy(null);
    }
  }

  const source =
    labelSource === "manual"
      ? t("documents.detail.manualLabelled")
      : labelSource === "ai"
        ? t("documents.detail.aiLabelled")
        : t("documents.detail.notLabelled");

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-sand-900">
          {t("documents.detail.labels")}
          <span className="ml-2 text-xs font-normal text-sand-500">{source}</span>
        </h2>
        {!editing ? (
          <div className="flex gap-2">
            {ready ? (
              <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => void relabel()}>
                {busy === "label" ? <Spinner /> : <Sparkles className="size-3.5" aria-hidden />}
                {busy === "label" ? t("documents.labelling") : t("documents.label")}
              </Button>
            ) : null}
            <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(true)}>
              {t("documents.detail.edit")}
            </Button>
          </div>
        ) : null}
      </div>

      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="mt-3 grid gap-3 sm:grid-cols-[6rem_minmax(0,1fr)] sm:items-center"
        >
          <label htmlFor={`${ids}-title`} className="text-xs font-medium text-sand-500">
            {t("documents.detail.fieldTitle")}
          </label>
          <Input
            id={`${ids}-title`}
            value={draft.title}
            maxLength={120}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
          <label htmlFor={`${ids}-type`} className="text-xs font-medium text-sand-500">
            {t("documents.detail.fieldType")}
          </label>
          <Select
            id={`${ids}-type`}
            value={draft.docType}
            onChange={(event) => setDraft({ ...draft, docType: event.target.value })}
            className="w-auto"
          >
            <option value="">—</option>
            {DOC_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`documents.docType.${type}` as MessageKey)}
              </option>
            ))}
          </Select>
          <label htmlFor={`${ids}-tags`} className="text-xs font-medium text-sand-500">
            {t("documents.detail.fieldTags")}
          </label>
          <div>
            <Input
              id={`${ids}-tags`}
              value={draft.tags}
              onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
            />
            <p className="mt-1 text-xs text-sand-400">{t("documents.detail.tagsHint")}</p>
          </div>
          <div className="flex gap-2 sm:col-start-2">
            <Button type="submit" size="sm" disabled={busy !== null}>
              {busy === "save" ? <Spinner className="border-white/40 border-t-white" /> : null}
              {t("documents.detail.save")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t("documents.detail.cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          {docType ? <Badge tone="neutral">{t(`documents.docType.${docType}` as MessageKey)}</Badge> : null}
          {tags.length > 0 ? (
            tags.map((tag) => (
              <span key={tag} className="text-xs text-sand-500">
                #{tag}
              </span>
            ))
          ) : (
            <span className="text-xs text-sand-400">{t("documents.detail.noTags")}</span>
          )}
        </div>
      )}
    </Card>
  );
}
