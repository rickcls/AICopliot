"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { Square, Voicemail } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import type { DictationLanguage } from "@/components/capture/dictation-button";
import { FOCUS_RING } from "@/components/ui";
import {
  encodeWav,
  splitSamples,
  TRANSCRIBE_SAMPLE_RATE,
} from "@/lib/audio/wav";
import { cn } from "@/lib/utils";

const MAX_RECORDING_MS = 10 * 60 * 1000;
const noop = () => () => {};

function recordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

/** Decodes whatever the browser recorded and resamples it to 16 kHz mono. */
async function toMonoSamples(blob: Blob): Promise<Float32Array> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const length = Math.max(1, Math.ceil(decoded.duration * TRANSCRIBE_SAMPLE_RATE));
    const offline = new OfflineAudioContext(1, length, TRANSCRIBE_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0);
  } finally {
    void context.close();
  }
}

function clock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * A voice memo, for when talking through the day is easier than typing it.
 *
 * Unlike live dictation this records first and transcribes after, with a
 * model that handles Cantonese mixed with English. The recording is converted
 * to WAV segments here (OpenRouter does not accept the browser's own webm),
 * each transcribed by its own request, and the text lands in the capture box
 * for the person to read before anything is made of it. No audio is kept.
 */
export function VoiceRecorder({
  language,
  onText,
  onActiveChange,
  disabled,
}: {
  language: DictationLanguage;
  onText: (text: string) => void;
  onActiveChange?: (active: boolean) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const supported = useSyncExternalStore(noop, recordingSupported, () => false);
  const [state, setState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  function setActive(next: "idle" | "recording" | "transcribing") {
    setState(next);
    onActiveChange?.(next !== "idle");
  }

  async function transcribe(blob: Blob) {
    setActive("transcribing");
    try {
      const segments = splitSamples(await toMonoSamples(blob), TRANSCRIBE_SAMPLE_RATE);
      setProgress({ done: 0, total: segments.length });
      const parts: string[] = [];
      for (const [index, segment] of segments.entries()) {
        const form = new FormData();
        form.append("audio", new Blob([encodeWav(segment, TRANSCRIBE_SAMPLE_RATE)], { type: "audio/wav" }), "memo.wav");
        form.append("language", language);
        const response = await fetch("/api/transcribe", { method: "POST", body: form });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error ?? t("voice.failed"));
        if (data.text) parts.push(data.text);
        setProgress({ done: index + 1, total: segments.length });
      }
      const text = parts.join(language === "en" ? " " : "").trim();
      if (text) onText(text);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("voice.failed"));
    } finally {
      setActive("idle");
    }
  }

  async function start() {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(t("voice.denied"));
      return;
    }
    const chunks: Blob[] = [];
    const instance = new MediaRecorder(stream);
    instance.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    instance.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      if (timer.current) clearInterval(timer.current);
      recorder.current = null;
      void transcribe(new Blob(chunks, { type: instance.mimeType }));
    };
    recorder.current = instance;
    const startedAt = Date.now();
    setElapsed(0);
    timer.current = setInterval(() => {
      const ms = Date.now() - startedAt;
      setElapsed(ms);
      if (ms >= MAX_RECORDING_MS) instance.stop();
    }, 500);
    instance.start(1000);
    setActive("recording");
  }

  if (!supported) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => (state === "recording" ? recorder.current?.stop() : void start())}
        disabled={(disabled && state === "idle") || state === "transcribing"}
        aria-pressed={state === "recording"}
        title={t("voice.maxLength")}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors",
          FOCUS_RING,
          state === "recording"
            ? "border-red-200 bg-red-50 text-red-700"
            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {state === "recording" ? (
          <Square className="size-3" fill="currentColor" aria-hidden />
        ) : (
          <Voicemail className="size-3.5" aria-hidden />
        )}
        {state === "recording" ? t("voice.stop") : t("voice.record")}
      </button>
      {state === "recording" ? (
        <span className="text-xs text-red-700 tabular-nums" aria-live="polite">
          {t("voice.recording", { time: clock(elapsed) })}
        </span>
      ) : state === "transcribing" ? (
        <span className="text-xs text-slate-500" aria-live="polite">
          {t("voice.transcribing", progress)}
        </span>
      ) : null}
      {error ? <span className="w-full text-xs text-red-700">{error}</span> : null}
    </>
  );
}
