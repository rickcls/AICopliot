"use client";

import { matchesQuery } from "@/lib/pm/filters";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { SUPPORTED_EXTENSIONS } from "@/lib/ingest/validate-upload";
import { formatBytes, formatDate } from "@/lib/utils";

interface DocumentRow {
  id: string;
  originalFilename: string;
  sizeBytes: number;
  status: "uploaded" | "processing" | "ready" | "failed";
  errorMessage: string | null;
  chunkCount: number;
  createdAt: string;
  projectId: string | null;
  project: { name: string } | null;
}

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

const STATUS_LABEL = {
  uploaded: "Uploaded",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
} as const;

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
  const [documents, setDocuments] = useState<DocumentRow[]>(initialDocuments);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProjectId, setUploadProjectId] = useState(
    fixedProject
      ? fixedProject.id
      : initialProjectFilter !== "all" && initialProjectFilter !== "unassigned"
      ? initialProjectFilter
      : "",
  );
  const [projectFilter, setProjectFilter] = useState(
    fixedProject?.id ?? initialProjectFilter,
  );
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const confirm = useConfirm();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/documents");
      if (!response.ok) throw new Error("Could not load documents");
      const data = await response.json();
      setDocuments(data.documents);
      setLoadError(null);
    } catch (error) {
      setLoadError((error as Error).message);
    }
  }, []);

  // Poll while anything is mid-ingestion. When ingestion moves to a queue this
  // is already the right UI shape — nothing here needs to change.
  const hasPending = documents.some(
    (d) => d.status === "uploaded" || d.status === "processing",
  );

  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [hasPending, load]);

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (uploadProjectId) formData.append("projectId", uploadProjectId);

      const response = await fetch("/api/documents", {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setUploadError(data.error ?? "Upload failed");
        return;
      }

      await load();

      // Kick off ingestion. The dashboard polls for the outcome, so we don't
      // block the UI on it — and errors still surface via the document's status.
      void fetch(`/api/documents/${data.id}/process`, { method: "POST" })
        .catch(() => undefined)
        .finally(() => void load());
    } catch {
      setUploadError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  /**
   * Re-runs ingestion for a document that failed. runIngestion clears any
   * partial chunks before retrying, so this is safe to click repeatedly.
   */
  async function handleRetry(id: string) {
    setLoadError(null);
    setDocuments((prev) =>
      prev.map((d) =>
        d.id === id ? { ...d, status: "processing", errorMessage: null } : d,
      ),
    );

    await fetch(`/api/documents/${id}/process`, { method: "POST" }).catch(
      () => undefined,
    );
    await load();
  }

  async function assignProject(documentId: string, projectId: string) {
    setAssigningId(documentId);
    setLoadError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: projectId || null }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLoadError(data.error ?? "Could not update the document project.");
        return;
      }
      setDocuments((previous) =>
        previous.map((document) =>
          document.id === documentId
            ? {
                ...document,
                projectId: data.document.projectId,
                project: data.document.project,
              }
            : document,
        ),
      );
    } catch {
      setLoadError("Could not update the document project.");
    } finally {
      setAssigningId(null);
    }
  }

  const visibleDocuments = documents.filter((document) => {
    if (!matchesQuery(query, [document.originalFilename])) return false;
    if (projectFilter === "all") return true;
    if (projectFilter === "unassigned") return document.projectId === null;
    return document.projectId === projectFilter;
  });

  async function handleDelete(id: string, filename: string) {
    const confirmed = await confirm({
      title: `Delete “${filename}”?`,
      body: "This also removes its indexed text, so it will no longer be available as evidence for answers.",
      confirmLabel: "Delete document",
      tone: "danger",
    });
    if (!confirmed) return;

    const response = await fetch(`/api/documents/${id}`, { method: "DELETE" });
    if (response.ok) {
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      toast.success(`Deleted “${filename}”`);
    } else {
      setLoadError("Could not delete that document.");
    }
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end justify-between gap-4 p-4">
        <div>
          <p className="text-sm font-medium">
            {fixedProject
              ? `Upload to ${fixedProject.name}`
              : "Upload a document"}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {SUPPORTED_EXTENSIONS.join(", ")} · up to 10 MB
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {!fixedProject ? (
            <div>
              <label
                htmlFor="upload-project"
                className="mb-1 block text-xs text-slate-500"
              >
                Project
              </label>
              <Select
                id="upload-project"
                value={uploadProjectId}
                onChange={(event) => setUploadProjectId(event.target.value)}
                disabled={uploading}
              >
                <option value="">Unassigned</option>
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
            id="file-upload"
            className="sr-only"
            accept={SUPPORTED_EXTENSIONS.join(",")}
            onChange={handleUpload}
            disabled={uploading}
          />
          <Button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <>
                <Spinner className="border-white/40 border-t-white" />
                Uploading…
              </>
            ) : (
              "Choose file"
            )}
          </Button>
        </div>
      </Card>

      <SectionHeader
        title={fixedProject ? "Documents in this project" : "Document library"}
        description={
          fixedProject
            ? "Only these documents are used when asking within this project."
            : `${documents.length} document${documents.length === 1 ? "" : "s"} across every project.`
        }
      >
        {documents.length > 0 ? (
          <SearchField
            label="Search documents by filename"
            placeholder="Search filenames"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full sm:w-56"
          />
        ) : null}
        {!fixedProject ? (
          <div className="flex items-center gap-2">
            <label htmlFor="project-filter" className="text-xs text-slate-500">
              Filter
            </label>
            <Select
              id="project-filter"
              value={projectFilter}
              onChange={(event) => setProjectFilter(event.target.value)}
            >
              <option value="all">All projects</option>
              <option value="unassigned">Unassigned</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </SectionHeader>

      {uploadError ? <ErrorState message={uploadError} /> : null}
      {loadError ? <ErrorState message={loadError} /> : null}

      {documents.length === 0 ? (
        <EmptyState
          title={fixedProject ? "This project has no documents" : "No documents yet"}
          description={
            fixedProject
              ? "Upload the first document for this project. Questions asked here will use only this project's documents."
              : "Upload a runbook, incident report, or policy document to start asking questions about it."
          }
          action={
            <Button type="button" onClick={() => fileInput.current?.click()}>
              Upload your first document
            </Button>
          }
        />
      ) : visibleDocuments.length === 0 ? (
        query.trim() ? (
          <EmptyState
            title="No filenames match"
            description={`Nothing here is named like “${query.trim()}”.`}
          />
        ) : (
          <EmptyState
            title="No documents in this project"
            description="Assign an existing document or upload a new one using the selected project."
          />
        )
      ) : (
        <Card className="divide-y divide-slate-100">
          {visibleDocuments.map((doc) => (
            <div
              key={doc.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/documents/${doc.id}`}
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {doc.originalFilename}
                </Link>
                {/* The project is not repeated here: on a project tab every
                    row would say the same thing, and in the library the
                    assignment select beside the row already names it. */}
                <p className="mt-0.5 text-xs text-slate-500">
                  {formatBytes(doc.sizeBytes)} · {formatDate(doc.createdAt)}
                  {doc.status === "ready"
                    ? ` · ${doc.chunkCount} chunks indexed`
                    : ""}
                </p>
                {doc.status === "failed" && doc.errorMessage ? (
                  <p className="mt-1 text-xs text-red-700">{doc.errorMessage}</p>
                ) : null}
              </div>

              {/* Ready is the normal state, so only the exceptions are badged;
                  the chunk count in the metadata line already says it is
                  indexed. */}
              {doc.status !== "ready" ? (
                <Badge tone={STATUS_TONE[doc.status]}>
                  {doc.status === "processing" ? (
                    <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-current" />
                  ) : null}
                  {STATUS_LABEL[doc.status]}
                </Badge>
              ) : null}

              {doc.status === "failed" ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleRetry(doc.id)}
                >
                  Retry
                </Button>
              ) : null}

              {!fixedProject ? (
                <Select
                  aria-label={`Project for ${doc.originalFilename}`}
                  value={doc.projectId ?? ""}
                  onChange={(event) =>
                    void assignProject(doc.id, event.target.value)
                  }
                  disabled={assigningId === doc.id}
                  className="h-8 max-w-44 text-xs"
                >
                  <option value="">Unassigned</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </Select>
              ) : null}

              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(doc.id, doc.originalFilename)}
              >
                Delete
              </Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
