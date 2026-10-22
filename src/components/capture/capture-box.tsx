"use client";

import { useId, useRef, useState } from "react";
import { strFromU8, unzipSync } from "fflate";
import { Paperclip, Sparkles } from "lucide-react";
import {
  DICTATION_LANGUAGES,
  DictationButton,
  LANGUAGE_KEY,
  useDictationSupported,
  type DictationLanguage,
} from "@/components/capture/dictation-button";
import { VoiceRecorder } from "@/components/capture/voice-recorder";
import { WhatsAppChat } from "@/components/capture/whatsapp-chat";
import { useT } from "@/components/i18n-provider";
import { Button, ErrorState, QUIET_CONTROL, Select, Spinner, Textarea } from "@/components/ui";
import type { CaptureView } from "@/lib/capture/view";
import { MAIL_FILE, MAX_MAIL_FILE_BYTES, mailFileToCaptureText } from "@/lib/mail/file";
import { cn } from "@/lib/utils";
import { parseWhatsAppChat, type ParsedChat } from "@/lib/whatsapp/parse";

/** Plain-text files are read in the browser; anything else is uploaded and indexed. */
const READ_LOCALLY = /\.(txt|md|markdown)$/i;
/** An iPhone exports a chat as a .zip holding `_chat.txt`; it is opened here, never uploaded. */
const CHAT_ARCHIVE = /\.zip$/i;
const ACCEPT = ".pdf,.docx,.md,.markdown,.txt,.csv,.zip,.eml,.msg";
/** An export with photos and video can run to gigabytes; only its text is wanted. */
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;

/** The chat text inside a WhatsApp export archive, or null. */
async function chatFromArchive(file: File): Promise<string | null> {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (entry) => entry.name.toLowerCase().endsWith(".txt"),
  });
  const names = Object.keys(entries);
  const name = names.find((entry) => entry.endsWith("_chat.txt")) ?? names[0];
  return name ? strFromU8(entries[name]) : null;
}

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
  const [speechLanguage, setSpeechLanguage] = useState<DictationLanguage>("yue");
  const languageId = useId();
  const dictationSupported = useDictationSupported();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A WhatsApp chat pasted or picked: shown as a chat to choose from, with its
  // raw text kept in case the person wants it as an ordinary note after all.
  const [chat, setChat] = useState<{ parsed: ParsedChat; raw: string } | null>(null);
  const [dragging, setDragging] = useState(false);

  function appendSpoken(spoken: string) {
    setDictated(true);
    setText((current) => (current ? `${current}${/\s$/.test(current) ? "" : " "}${spoken}` : spoken));
  }

  async function send(
    payload: { text: string; source: "text" | "voice" | "whatsapp" | "email" } | { documentId: string },
  ) {
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

  async function sendChat(body: string) {
    setBusy(t("capture.submitting"));
    setError(null);
    try {
      await send({ text: body, source: "whatsapp" });
      setChat(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("capture.sendFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function captureFile(file: File) {
    setError(null);
    // An email file: read here and captured as someone else's words, like a
    // checked Gmail or Outlook message. The file itself goes nowhere.
    if (MAIL_FILE.test(file.name)) {
      try {
        if (file.size > MAX_MAIL_FILE_BYTES) throw new Error(t("capture.mailFileTooLarge"));
        setBusy(t("capture.readingMail", { name: file.name }));
        const body = await mailFileToCaptureText(file.name, await file.arrayBuffer());
        if (!body) throw new Error(t("capture.mailFileEmpty"));
        setBusy(t("capture.submitting"));
        await send({ text: body, source: "email" });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : t("capture.mailFileEmpty"));
      } finally {
        setBusy(null);
        if (fileInput.current) fileInput.current.value = "";
      }
      return;
    }
    if (CHAT_ARCHIVE.test(file.name)) {
      try {
        if (file.size > MAX_ARCHIVE_BYTES) throw new Error(t("capture.whatsappTooLarge"));
        const raw = await chatFromArchive(file);
        const parsed = raw ? parseWhatsAppChat(raw) : null;
        if (!raw || !parsed) throw new Error(t("capture.whatsappNotRecognised"));
        setChat({ parsed, raw });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : t("capture.whatsappNotRecognised"));
      } finally {
        if (fileInput.current) fileInput.current.value = "";
      }
      return;
    }
    if (READ_LOCALLY.test(file.name)) {
      const content = await file.text();
      const parsed = parseWhatsAppChat(content);
      if (parsed) setChat({ parsed, raw: content });
      else setText((current) => (current ? `${current}\n${content}` : content));
      if (fileInput.current) fileInput.current.value = "";
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
      // A file can be dropped anywhere on the box — an email dragged out of
      // Outlook arrives as a .msg, an exported chat as a .zip or .txt.
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        const file = event.dataTransfer.files?.[0];
        if (!file) return;
        event.preventDefault();
        setDragging(false);
        if (busy === null) void captureFile(file);
      }}
      // One soft card with the writing area borderless inside it: a bordered
      // field inside a bordered box read as a form to fill in, not a place to
      // talk. The card itself shows focus, so the field can drop its ring.
      className={cn(
        "overflow-hidden rounded-2xl border bg-white shadow-soft transition-shadow",
        dragging
          ? "border-brand-400 ring-4 ring-brand-100"
          : "border-sand-200/80 focus-within:border-brand-300 focus-within:ring-4 focus-within:ring-brand-100/70",
      )}
    >
      <label
        htmlFor={inputId}
        className="flex items-center gap-2 px-5 pt-4 text-sm font-semibold text-sand-900"
      >
        <Sparkles aria-hidden className="size-4 text-brand-600" />
        {t("capture.inputLabel")}
      </label>
      {chat ? (
        <div className="px-5 pb-4">
          <WhatsAppChat
            chat={chat.parsed}
            busy={busy}
            onSend={(body) => void sendChat(body)}
            onUseAsText={() => {
              setText((current) => (current ? `${current}\n${chat.raw}` : chat.raw));
              setChat(null);
            }}
            onCancel={() => setChat(null)}
          />
        </div>
      ) : null}
      {/* While a chat is being chosen, it is the only thing to send. */}
      {chat ? null : (
        <>
          <Textarea
            id={inputId}
            value={text}
            rows={4}
            maxLength={8000}
            placeholder={t("capture.placeholder")}
            disabled={busy !== null}
            onChange={(event) => setText(event.target.value)}
            onPaste={(event) => {
              // A pasted WhatsApp chat becomes a chat to choose from, not a wall of text.
              const pasted = event.clipboardData.getData("text");
              const parsed = parseWhatsAppChat(pasted);
              if (!parsed) return;
              event.preventDefault();
              setChat({ parsed, raw: pasted });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void submit();
              }
            }}
            className="mt-1 resize-none rounded-none border-0 bg-transparent px-5 py-2 text-[15px] leading-relaxed focus-visible:ring-0 focus-visible:ring-offset-0"
          />

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sand-100 bg-sand-50/60 px-3 py-2.5">
            {/* Full width on a phone, so the input tools share one row and the
                send button takes the next, instead of each tool on its own line. */}
            <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:flex-1">
              <label htmlFor={languageId} className="sr-only">
                {t("voice.language")}
              </label>
              <Select
                id={languageId}
                value={speechLanguage}
                disabled={listening}
                onChange={(event) => setSpeechLanguage(event.target.value as DictationLanguage)}
                className={cn(QUIET_CONTROL, "h-8 rounded-lg px-1.5 text-xs text-sand-600")}
              >
                {DICTATION_LANGUAGES.map((option) => (
                  <option key={option} value={option}>
                    {t(LANGUAGE_KEY[option])}
                  </option>
                ))}
              </Select>
              <DictationButton
                language={speechLanguage}
                disabled={busy !== null}
                onListeningChange={setListening}
                onText={appendSpoken}
              />
              <VoiceRecorder
                language={speechLanguage}
                disabled={busy !== null || listening}
                onActiveChange={setListening}
                onText={appendSpoken}
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
            <div className="ml-auto flex items-center gap-3">
              <span className="hidden text-xs text-sand-400 sm:inline">
                {t("capture.shortcutHint", { key: "Ctrl/⌘" })}
              </span>
              <Button type="submit" disabled={busy !== null || listening || text.trim().length < 3}>
                {busy ? <Spinner className="border-white/40 border-t-white" /> : <Sparkles className="size-4" aria-hidden />}
                {busy ?? t("capture.submit")}
              </Button>
            </div>
          </div>
        </>
      )}

      {dictationSupported && !chat ? (
        <p className="bg-sand-50/60 px-5 pb-2.5 text-xs text-sand-500">
          {t("voice.privacy")}
        </p>
      ) : null}

      {error ? (
        <div className="px-5 pb-4">
          <ErrorState message={error} />
        </div>
      ) : null}
    </form>
  );
}
