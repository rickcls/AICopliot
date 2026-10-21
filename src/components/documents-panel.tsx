"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileUp, Sparkles } from "lucide-react";
import { useConfirm } from "@/components/confirm-dialog";
import { useLocale, useT, useTimeZone } from "@/components/i18n-provider";
import { useToast } from "@/components/toast";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  SearchField,
  SectionHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { DocumentRow } from "@/lib/documents/select";
import { intlLocale } from "@/lib/i18n/locales";
import type { MessageKey } from "@/lib/i18n/translate";
import { UPLOAD_EXTENSIONS, asUploadable, mailFileErrorKey } from "@/lib/mail/document";
import { matchesQuery } from "@/lib/pm/filters";
import { cn, formatBytes, formatInstantDay } from "@/lib/utils";

interface ProjectOption {
  id: string;
  name: string;
}

const STATUS_TONE = {
  uploaded: "info",
  processing: "warning",
  ready: "success",
  failed: "danger",
} as const;

/** Two at a time: fast enough for a handful of files, gentle on a 60s server. */
const UPLOAD_CONCURRENCY = 2;
const MAX_UPLOAD_MB = 10;

/**
 * The document library, for the whole workspace or one project.
 *
 * House pattern: one line per document — its name (the AI or person-written
 * title when there is one), the facts that identify it, and only the
 * exceptions badged (not ready, failed, filed somewhere it seems not to
 * belong). Files can be dropped in several at a time; each is uploaded,
 * indexed, then labelled by the assistant, through the same routes as before,
 * so every one is validated and stored the same way.
 */
export function DocumentsPanel({
  initialDocuments,
  projects,
  initialProjectFilter = "all",
  fixedProject,
}: {
  initialDocuments: DocumentRow[];
  projects: ProjectOption[];
  initialProjectFilter?: string;
  fixedProject?: ProjectOption;
}) {
  const t = useT();
  const locale = useLocale();
  const dateLocale = intlLocale(locale);
  const timeZone = useTimeZone();
  const [documents, setDocuments] = useState<DocumentRow[]>(initialDocuments);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploadProjectId, setUploadProjectId] = useState(
    fixedProject
      ? fixedProject.id
      : initialProjectFilter !== "all" && initialProjectFilter !== "unassigned"
        ? initialProjectFilter
        : "",
  );
  const [projectFilter, setProjectFilter] = useState(fixedProject?.id ?? initialProjectFilter);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<"move" | "label" | null>(null);
  const [query, setQuery] = useState("");
  const confirm = useConfirm();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const fixedProjectId = fixedProject?.id;
  const load = useCallback(async () => {
    try {
      // A project page only ever shows its own documents, so it only polls
      // for them rather than re-downloading the whole workspace every tick.
      const response = await fetch(
        fixedProjectId
          ? `/api/documents?projectId=${encodeURIComponent(fixedProjectId)}`
          : "/api/documents",
      );
      if (!response.ok) throw new Error();
      const data = await response.json();
      setDocuments(data.documents);
      setLoadError(null);
    } catch {
      setLoadError(t("common.couldNotReach"));
    }
  }, [fixedProjectId, t]);

  // Poll while anything is mid-ingestion. When ingestion moves to a queue this
  // is already the right UI shape — nothing here needs to change.
  const hasPending = documents.some((d) => d.status === "uploaded" || d.status === "processing");

  // Quick at first, when a small file is about to finish, then slower: a
  // document stuck in `uploaded` would otherwise be polled every two seconds
  // for as long as the tab stays open.
  useEffect(() => {
    if (!hasPending) return;
    const startedAt = Date.now();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const delay = Date.now() - startedAt < 30_000 ? 2000 : 5000;
      timer = setTimeout(async () => {
        await load();
        if (!cancelled) tick();
      }, delay);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hasPending, load]);

  function markBusy(id: string, busy: boolean) {
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function label(id: string): Promise<boolean> {
    markBusy(id, true);
    try {
      const response = await fetch(`/api/documents/${id}/label`, { method: "POST" });
      return response.ok;
    } catch {
      return false;
    } finally {
      markBusy(id, false);
    }
  }

  /**
   * Upload → index → label, for one file. Errors are collected, not thrown.
   * An email is read here and uploaded as its Markdown document.
   */
  async function uploadOne(chosen: File): Promise<string | null> {
    let file: File;
    try {
      file = await asUploadable(chosen);
    } catch (caught) {
      const key = mailFileErrorKey(caught);
      return t("documents.uploadFailed", { name: chosen.name, error: key ? t(key) : t("common.couldNotReach") });
    }
    const formData = new FormData();
    formData.append("file", file);
    if (uploadProjectId) formData.append("projectId", uploadProjectId);
    try {
      const response = await fetch("/api/documents", { method: "POST", body: formData });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return t("documents.uploadFailed", { name: file.name, error: data.error ?? response.status });
      await load();
      const processed = await fetch(`/api/documents/${data.id}/process`, { method: "POST" });
      if (processed.ok) await label(data.id);
      await load();
      return null;
    } catch {
      return t("documents.uploadFailed", { name: file.name, error: t("common.couldNotReach") });
    }
  }

  async function uploadAll(files: File[]) {
    if (files.length === 0) return;
    setUploadErrors([]);
    setProgress({ done: 0, total: files.length });
    const queue = [...files];
    const errors: string[] = [];
    let done = 0;
    await Promise.all(
      Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, async () => {
        for (let file = queue.shift(); file; file = queue.shift()) {
          const error = await uploadOne(file);
          if (error) errors.push(error);
          done += 1;
          setProgress({ done, total: files.length });
        }
      }),
    );
    setProgress(null);
    setUploadErrors(errors);
    if (fileInput.current) fileInput.current.value = "";
  }

  /** Re-runs ingestion; runIngestion clears partial chunks, so this is safe to repeat. */
  async function handleRetry(id: string) {
    setLoadError(null);
    setDocuments((previous) =>
      previous.map((d) => (d.id === id ? { ...d, status: "processing", errorMessage: null } : d)),
    );
    const processed = await fetch(`/api/documents/${id}/process`, { method: "POST" }).catch(() => null);
    if (processed?.ok) await label(id);
    await load();
  }

  async function assignProject(documentId: string, projectId: string): Promise<boolean> {
    markBusy(documentId, true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: projectId || null }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLoadError(data.error ?? t("documents.moveFailed"));
        return false;
      }
      setDocuments((previous) =>
        previous.map((document) =>
          document.id === documentId
            ? {
                ...document,
                projectId: data.document.projectId,
                project: data.document.project,
                suggestedProjectId: null,
                suggestedProject: null,
              }
            : document,
        ),
      );
      return true;
    } catch {
      setLoadError(t("documents.moveFailed"));
      return false;
    } finally {
      markBusy(documentId, false);
    }
  }

  async function handleDelete(doc: DocumentRow) {
    const name = doc.title ?? doc.originalFilename;
    const confirmed = await confirm({
      title: t("documents.deleteTitle", { name }),
      body: t("documents.deleteBody"),
      confirmLabel: t("documents.delete"),
      tone: "danger",
    });
    if (!confirmed) return;

    const response = await fetch(`/api/documents/${doc.id}`, { method: "DELETE" });
    if (response.ok) {
      setDocuments((previous) => previous.filter((d) => d.id !== doc.id));
      toast.success(t("documents.deleted", { name }));
    } else {
      setLoadError(t("documents.deleteFailed"));
    }
  }

  const visibleDocuments = documents.filter((document) => {
    if (!matchesQuery(query, [document.originalFilename, document.title ?? "", ...document.tags])) {
      return false;
    }
    if (projectFilter === "all") return true;
    if (projectFilter === "unassigned") return document.projectId === null;
    return document.projectId === projectFilter;
  });
  const withSuggestion = visibleDocuments.filter((doc) => doc.suggestedProjectId);
  const unlabelled = visibleDocuments.filter((doc) => doc.status === "ready" && !doc.labelledAt);

  async function moveAllSuggested() {
    setBulk("move");
    for (const doc of withSuggestion) {
      if (doc.suggestedProjectId) await assignProject(doc.id, doc.suggestedProjectId);
    }
    setBulk(null);
  }

  async function labelAll() {
    setBulk("label");
    for (const doc of unlabelled) {
      if (!(await label(doc.id))) {
        toast.error(t("documents.labelFailed", { name: doc.originalFilename }));
      }
    }
    await load();
    setBulk(null);
  }

  return (
    <div className="space-y-4">
      <Card
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!progress) void uploadAll([...event.dataTransfer.files]);
        }}
        className={cn(
          "flex flex-wrap items-end justify-between gap-4 border-dashed p-4 transition-colors",
          dragging ? "border-slate-900 bg-slate-100" : undefined,
        )}
      >
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {dragging
              ? t("documents.dropHere")
              : fixedProject
                ? t("documents.uploadTo", { project: fixedProject.name })
                : t("documents.uploadTitle")}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {t("documents.uploadHint", {
              types: UPLOAD_EXTENSIONS.join(", "),
              size: MAX_UPLOAD_MB,
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {!fixedProject ? (
            <div>
              <label htmlFor="upload-project" className="mb-1 block text-xs text-slate-500">
                {t("documents.project")}
              </label>
              <Select
                id="upload-project"
                value={uploadProjectId}
                onChange={(event) => setUploadProjectId(event.target.value)}
                disabled={progress !== null}
              >
                <option value="">{t("documents.unassigned")}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <input
            ref={fileInput}
            type="file"
            multiple
            className="sr-only"
            tabIndex={-1}
            accept={UPLOAD_EXTENSIONS.join(",")}
            onChange={(event) => void uploadAll([...(event.target.files ?? [])])}
            disabled={progress !== null}
          />
          <Button type="button" onClick={() => fileInput.current?.click()} disabled={progress !== null}>
            {progress ? (
              <>
                <Spinner className="border-white/40 border-t-white" />
                {t("documents.uploading", progress)}
              </>
            ) : (
              <>
                <FileUp className="size-4" aria-hidden />
                {t("documents.choose")}
              </>
            )}
          </Button>
        </div>
      </Card>

      <SectionHeader
        title={fixedProject ? t("documents.projectLibraryTitle") : t("documents.libraryTitle")}
        description={
          fixedProject
            ? t("documents.projectLibraryLead")
            : t("documents.libraryLead", { count: documents.length })
        }
      >
        {documents.length > 0 ? (
          <SearchField
            label={t("documents.quickFilter")}
            placeholder={t("documents.quickFilterPlaceholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full sm:w-56"
          />
        ) : null}
        {!fixedProject ? (
          <div className="flex items-center gap-2">
            <label htmlFor="project-filter" className="text-xs text-slate-500">
              {t("documents.filterLabel")}
            </label>
            <Select
              id="project-filter"
              value={projectFilter}
              onChange={(event) => setProjectFilter(event.target.value)}
            >
              <option value="all">{t("documents.allProjects")}</option>
              <option value="unassigned">{t("documents.unassigned")}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </SectionHeader>

      {uploadErrors.map((error) => (
        <ErrorState key={error} message={error} />
      ))}
      {loadError ? <ErrorState message={loadError} /> : null}

      {withSuggestion.length > 0 || unlabelled.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {withSuggestion.length > 0 && !fixedProject ? (
            <Button type="button" size="sm" variant="secondary" disabled={bulk !== null} onClick={() => void moveAllSuggested()}>
              {bulk === "move" ? <Spinner /> : null}
              {t("documents.moveAllSuggested", { count: withSuggestion.length })}
            </Button>
          ) : null}
          {unlabelled.length > 0 ? (
            <Button type="button" size="sm" variant="secondary" disabled={bulk !== null} onClick={() => void labelAll()}>
              {bulk === "label" ? <Spinner /> : <Sparkles className="size-3.5" aria-hidden />}
              {t("documents.labelAll", { count: unlabelled.length })}
            </Button>
          ) : null}
        </div>
      ) : null}

      {documents.length === 0 ? (
        <EmptyState
          title={fixedProject ? t("documents.emptyProjectTitle") : t("documents.emptyTitle")}
          description={fixedProject ? t("documents.emptyProjectBody") : t("documents.emptyBody")}
          action={
            <Button type="button" onClick={() => fileInput.current?.click()}>
              {t("documents.uploadFirst")}
            </Button>
          }
        />
      ) : visibleDocuments.length === 0 ? (
        query.trim() ? (
          <EmptyState
            title={t("documents.noMatchTitle")}
            description={t("documents.noMatchBody", { query: query.trim() })}
          />
        ) : (
          <EmptyState title={t("documents.noneInProject")} description={t("documents.noneInProjectBody")} />
        )
      ) : (
        <Card className="divide-y divide-slate-100">
          {visibleDocuments.map((doc) => {
            const busy = busyIds.has(doc.id);
            const meta = [
              doc.docType ? t(`documents.docType.${doc.docType}` as MessageKey) : null,
              doc.title ? doc.originalFilename : null,
              formatBytes(doc.sizeBytes),
              formatInstantDay(doc.createdAt, dateLocale, timeZone),
              doc.status === "ready" ? t("documents.passages", { count: doc.chunkCount }) : null,
            ].filter(Boolean);

            return (
              <div key={doc.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/documents/${doc.id}`}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {doc.title ?? doc.originalFilename}
                  </Link>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {meta.join(" · ")}
                    {doc.tags.length > 0 ? (
                      <span className="ml-2 text-slate-400">
                        {doc.tags.slice(0, 4).map((tag) => `#${tag}`).join(" ")}
                      </span>
                    ) : null}
                  </p>
                  {doc.status === "failed" && doc.errorMessage ? (
                    <p className="mt-1 text-xs text-red-700">{doc.errorMessage}</p>
                  ) : null}
                  {doc.suggestedProjectId && doc.suggestedProject && !fixedProject ? (
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-amber-800">
                      {t("documents.suggested", { project: doc.suggestedProject.name })}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void assignProject(doc.id, doc.suggestedProjectId!)}
                        className="font-medium underline underline-offset-2 hover:text-amber-950 disabled:opacity-50"
                      >
                        {t("documents.moveToSuggested")}
                      </button>
                    </p>
                  ) : null}
                </div>

                {/* Ready is the normal state, so only the exceptions are badged. */}
                {doc.status !== "ready" ? (
                  <Badge tone={STATUS_TONE[doc.status]}>
                    {doc.status === "processing" ? (
                      <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-current" />
                    ) : null}
                    {t(`documents.status.${doc.status}`)}
                  </Badge>
                ) : null}

                {doc.status === "failed" ? (
                  <Button variant="secondary" size="sm" onClick={() => void handleRetry(doc.id)}>
                    {t("documents.retry")}
                  </Button>
                ) : null}

                {doc.status === "ready" && !doc.labelledAt ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      if (!(await label(doc.id))) {
                        toast.error(t("documents.labelFailed", { name: doc.originalFilename }));
                      }
                      await load();
                    }}
                  >
                    {busy ? <Spinner /> : <Sparkles className="size-3.5" aria-hidden />}
                    {busy ? t("documents.labelling") : t("documents.label")}
                  </Button>
                ) : null}

                {!fixedProject ? (
                  <Select
                    aria-label={t("documents.projectFor", { name: doc.originalFilename })}
                    value={doc.projectId ?? ""}
                    onChange={(event) => void assignProject(doc.id, event.target.value)}
                    disabled={busy}
                    className="h-8 max-w-44 text-xs"
                  >
                    <option value="">{t("documents.unassigned")}</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </Select>
                ) : null}

                <Button variant="ghost" size="sm" onClick={() => void handleDelete(doc)}>
                  {t("documents.delete")}
                </Button>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
