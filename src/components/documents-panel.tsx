"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Spinner,
} from "@/components/ui";
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
}: {
  initialDocuments: DocumentRow[];
}) {
  const [documents, setDocuments] = useState<DocumentRow[]>(initialDocuments);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
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

  async function handleDelete(id: string, filename: string) {
    if (!confirm(`Delete "${filename}"? This also removes its indexed text.`)) {
      return;
    }
    const response = await fetch(`/api/documents/${id}`, { method: "DELETE" });
    if (response.ok) {
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    } else {
      setLoadError("Could not delete that document.");
    }
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div>
          <p className="text-sm font-medium">Upload a document</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {SUPPORTED_EXTENSIONS.join(", ")} · up to 10 MB
          </p>
        </div>
        <div>
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

      {uploadError ? <ErrorState message={uploadError} /> : null}
      {loadError ? <ErrorState message={loadError} /> : null}

      {documents.length === 0 ? (
        <EmptyState
          title="No documents yet"
          description="Upload a runbook, incident report, or policy document to start asking questions about it."
          action={
            <Button type="button" onClick={() => fileInput.current?.click()}>
              Upload your first document
            </Button>
          }
        />
      ) : (
        <Card className="divide-y divide-slate-100">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/documents/${doc.id}`}
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {doc.originalFilename}
                </Link>
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

              <Badge tone={STATUS_TONE[doc.status]}>
                {doc.status === "processing" ? (
                  <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-current" />
                ) : null}
                {STATUS_LABEL[doc.status]}
              </Badge>

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
