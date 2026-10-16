"use client";

import { useId, useRef, useState } from "react";
import { Paperclip, Sparkles } from "lucide-react";
import { DictationButton } from "@/components/capture/dictation-button";
import { useT } from "@/components/i18n-provider";
import { Button, ErrorState, Spinner, Textarea } from "@/components/ui";
import type { CaptureView } from "@/lib/capture/view";

/** Plain-text files are read in the browser; anything else is uploaded and indexed. */
const READ_LOCALLY = /\.(txt|md|markdown)$/i;
const ACCEPT = ".pdf,.docx,.md,.markdown,.txt,.csv";

/**
 * Where a person tells the assistant something: type, paste, dictate, or pick
 * a file. Submitting saves the note first and then asks for suggestions, so
 * nothing typed is lost if the model fails.
 *
 * A PDF or Word file goes through the ordinary upload route — three-way
 * validation, storage, indexing — into the person's personal project, and is
 * captured once it is ready. It is then a normal document: searchable, and
 * linked to any task applied from it in the same project.
 */
export function CaptureBox({
  personalProjectId,
  onCaptured,
}: {
  personalProjectId: string;
  onCaptured: (capture: CaptureView) => void;
}) {
  const t = useT();
  const inputId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [dictated, setDictated] = useState(false);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(payload: { text: string; source: "text" | "voice" } | { documentId: string }) {
    const response = await fetch("/api/captures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.capture) {
      throw new Error(data.error ?? t("capture.sendFailed"));
    }
    onCaptured(data.capture as CaptureView);
  }

  async function submit() {
    const note = text.trim();
    if (note.length < 3 || busy) return;
    setBusy(t("capture.submitting"));
    setError(null);
    try {
      await send({ text: note, source: dictated ? "voice" : "text" });
      setText("");
      setDictated(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("capture.sendFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function captureFile(file: File) {
    setError(null);
    if (READ_LOCALLY.test(file.name)) {
      const content = await file.text();
      setText((current) => (current ? `${current}\n${content}` : content));
      return;
    }

    try {
      setBusy(t("capture.uploading", { name: file.name }));
      const form = new FormData();
      form.append("file", file);
      form.append("projectId", personalProjectId);
      const upload = await fetch("/api/documents", { method: "POST", body: form });
      const uploaded = await upload.json().catch(() => ({}));
      if (!upload.ok || !uploaded.id) throw new Error(uploaded.error ?? t("capture.fileFailed"));

      setBusy(t("capture.indexing", { name: file.name }));
      const processed = await fetch(`/api/documents/${uploaded.id}/process`, { method: "POST" });
      const result = await processed.json().catch(() => ({}));
      if (!processed.ok || result.status !== "ready") {
        throw new Error(result.error ?? t("capture.fileFailed"));
      }

      setBusy(t("capture.submitting"));
      await send({ documentId: uploaded.id });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("capture.fileFailed"));
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <label htmlFor={inputId} className="text-sm font-semibold text-slate-900">
        {t("capture.inputLabel")}
      </label>
      <Textarea
        id={inputId}
        value={text}
        rows={4}
        maxLength={8000}
        placeholder={t("capture.placeholder")}
        disabled={busy !== null}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
        className="mt-2"
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <DictationButton
            disabled={busy !== null}
            onListeningChange={setListening}
            onText={(spoken) => {
              setDictated(true);
              setText((current) => (current ? `${current}${/\s$/.test(current) ? "" : " "}${spoken}` : spoken));
            }}
          />
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void captureFile(file);
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy !== null || listening}
            onClick={() => fileInput.current?.click()}
          >
            <Paperclip className="size-3.5" aria-hidden />
            {t("capture.fromFile")}
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-slate-400 sm:inline">
            {t("capture.shortcutHint", { key: "Ctrl/⌘" })}
          </span>
          <Button type="submit" disabled={busy !== null || listening || text.trim().length < 3}>
            {busy ? <Spinner className="border-white/40 border-t-white" /> : <Sparkles className="size-4" aria-hidden />}
            {busy ?? t("capture.submit")}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mt-3">
          <ErrorState message={error} />
        </div>
      ) : null}
    </form>
  );
}
