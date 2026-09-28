"use client";

import { useRef, useState } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import { Badge, QUIET_CONTROL, Select, Spinner, buttonClasses } from "@/components/ui";
import type { ProjectDocumentOption } from "@/components/task-types";
import { SUPPORTED_EXTENSIONS } from "@/lib/ingest/validate-upload";
import { cn } from "@/lib/utils";

/**
 * A task's documents: the ones linked, a picker for the rest of the project's,
 * and an upload that adds a new one.
 *
 * An upload here is an ordinary project upload — the same `/api/documents`
 * route, the same three-way validation, the same indexing — so the file
 * appears in the Documents tab and is searchable by chat like any other. The
 * task only holds a link to it.
 *
 * The component never decides *when* a link is saved. The task form keeps ids
 * in its draft until Save; the detail panel saves each change at once.
 */
export function TaskDocumentsField({
  projectId,
  linked,
  available,
  disabled,
  onAdd,
  onRemove,
  onDocumentChange,
}: {
  projectId: string;
  linked: ProjectDocumentOption[];
  /** Every document in the project, kept current by the board. */
  available: ProjectDocumentOption[];
  disabled?: boolean;
  onAdd: (document: ProjectDocumentOption) => void;
  onRemove: (documentId: string) => void;
  /** An upload created or finished processing a document. */
  onDocumentChange: (document: ProjectDocumentOption) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linkedIds = new Set(linked.map((document) => document.id));
  const unlinked = available.filter((document) => !linkedIds.has(document.id));

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("projectId", projectId);
      const response = await fetch("/api/documents", {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        // Vercel refuses bodies over 4.5 MB before the route runs, with no JSON.
        setError(
          data.error ??
            (response.status === 413 ? "That file is too large to upload." : "Upload failed."),
        );
        return;
      }

      const document: ProjectDocumentOption = {
        id: data.id,
        originalFilename: file.name,
        status: "processing",
      };
      onDocumentChange(document);
      onAdd(document);

      // Indexing runs inside this request and can take a while for a large
      // PDF; the chip says so meanwhile, and the link does not wait on it.
      const processed = await fetch(`/api/documents/${data.id}/process`, {
        method: "POST",
      })
        .then((result) => result.json())
        .catch(() => ({ status: "failed" }));
      onDocumentChange({
        ...document,
        status: processed.status === "ready" ? "ready" : "failed",
      });
      if (processed.status !== "ready") {
        setError(
          `${file.name} could not be processed${processed.error ? `: ${processed.error}` : "."} Retry it from the Documents tab.`,
        );
      }
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      {linked.length > 0 ? (
        <ul className="space-y-1">
          {linked.map((document) => (
            <li
              key={document.id}
              className="group flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-50"
            >
              <FileText className="size-4 shrink-0 text-slate-400" aria-hidden />
              <a
                href={`/documents/${document.id}`}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate text-slate-800 hover:underline"
              >
                {document.originalFilename}
              </a>
              {document.status === "failed" ? (
                <Badge tone="danger">Failed</Badge>
              ) : document.status !== "ready" ? (
                <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                  <Spinner className="size-3" />
                  Indexing
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => onRemove(document.id)}
                disabled={disabled}
                aria-label={`Unlink ${document.originalFilename}`}
                title="Unlink (the document stays in the project)"
                className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-50"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {unlinked.length > 0 ? (
          <Select
            aria-label="Link a project document"
            className={cn(QUIET_CONTROL, "max-w-xs text-slate-500")}
            value=""
            disabled={disabled}
            onChange={(event) => {
              const document = unlinked.find((item) => item.id === event.target.value);
              if (document) onAdd(document);
            }}
          >
            <option value="">Link a project document…</option>
            {unlinked.map((document) => (
              <option key={document.id} value={document.id}>
                {document.originalFilename}
                {document.status === "ready" ? "" : ` (${document.status})`}
              </option>
            ))}
          </Select>
        ) : null}

        <label
          className={buttonClasses({
            variant: "ghost",
            size: "sm",
            className: cn(
              "cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-slate-900",
              (disabled || uploading) && "pointer-events-none opacity-50",
            ),
          })}
        >
          {uploading ? <Spinner className="size-3.5" /> : <Paperclip className="size-3.5" aria-hidden />}
          {uploading ? "Uploading…" : "Upload"}
          <input
            ref={fileInput}
            type="file"
            accept={SUPPORTED_EXTENSIONS.join(",")}
            className="sr-only"
            disabled={disabled || uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
        </label>
      </div>

      {error ? (
        <p role="alert" className="text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
