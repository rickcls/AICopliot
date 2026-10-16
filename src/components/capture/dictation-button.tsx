"use client";

import { useId, useRef, useState, useSyncExternalStore } from "react";
import { Mic, MicOff } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { FOCUS_RING } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Dictation through the browser's own speech recognition (Web Speech API).
 * Free and with no server of ours involved — but the browser sends the audio
 * to its vendor's speech service, which the button says out loud.
 *
 * Language tags differ between browsers (Chrome names Cantonese
 * `yue-Hant-HK`, Safari `zh-HK`), so each language lists its tags in order and
 * a `language-not-supported` error moves on to the next one.
 */

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noop = () => () => {};

export type DictationLanguage = "yue" | "cmn" | "en";

const LANGUAGE_TAGS: Record<DictationLanguage, string[]> = {
  yue: ["yue-Hant-HK", "zh-HK"],
  cmn: ["cmn-Hant-TW", "zh-TW"],
  en: ["en-GB", "en-US"],
};

const LANGUAGE_KEY = {
  yue: "dictation.cantonese",
  cmn: "dictation.mandarin",
  en: "dictation.english",
} as const;

export function DictationButton({
  onText,
  onListeningChange,
  disabled,
}: {
  /** Called with each finished phrase, to append to the note. */
  onText: (text: string) => void;
  onListeningChange?: (listening: boolean) => void;
  disabled?: boolean;
}) {
  const t = useT();
  // Server snapshot is false, so the server render and hydration agree and the
  // button appears only once the browser is known to support it.
  const supported = useSyncExternalStore(noop, () => recognitionCtor() !== null, () => false);
  const [language, setLanguage] = useState<DictationLanguage>("yue");
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const languageId = useId();

  function setActive(value: boolean) {
    setListening(value);
    onListeningChange?.(value);
  }

  function start(tagIndex = 0) {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const tags = LANGUAGE_TAGS[language];
    const instance = new Ctor();
    instance.lang = tags[tagIndex];
    instance.continuous = true;
    instance.interimResults = true;

    instance.onresult = (event) => {
      let pending = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        if (!text) continue;
        if (result.isFinal) onText(text);
        else pending += text;
      }
      setInterim(pending);
    };
    instance.onerror = (event) => {
      if (event.error === "language-not-supported" && tagIndex + 1 < tags.length) {
        instance.onend = null;
        start(tagIndex + 1);
        return;
      }
      if (event.error !== "aborted" && event.error !== "no-speech") {
        setError(t("dictation.failed", { error: event.error }));
      }
    };
    instance.onend = () => {
      setInterim("");
      setActive(false);
      recognition.current = null;
    };

    recognition.current = instance;
    setError(null);
    setActive(true);
    instance.start();
  }

  function stop() {
    recognition.current?.stop();
  }

  if (!supported) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => (listening ? stop() : start())}
        disabled={disabled && !listening}
        aria-pressed={listening}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors",
          FOCUS_RING,
          listening
            ? "border-red-200 bg-red-50 text-red-700"
            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {listening ? <MicOff className="size-3.5" aria-hidden /> : <Mic className="size-3.5" aria-hidden />}
        {listening ? t("dictation.stop") : t("dictation.start")}
      </button>
      <label className="sr-only" htmlFor={languageId}>
        {t("dictation.language")}
      </label>
      <select
        id={languageId}
        value={language}
        disabled={listening}
        onChange={(event) => setLanguage(event.target.value as DictationLanguage)}
        className={cn(
          "h-8 rounded-lg border border-transparent bg-transparent px-1.5 text-xs text-slate-600 hover:bg-slate-100",
          FOCUS_RING,
        )}
      >
        {(Object.keys(LANGUAGE_TAGS) as DictationLanguage[]).map((option) => (
          <option key={option} value={option}>
            {t(LANGUAGE_KEY[option])}
          </option>
        ))}
      </select>
      {listening ? (
        <span className="min-w-0 truncate text-xs text-slate-500" aria-live="polite">
          {interim || t("dictation.listening")}
        </span>
      ) : (
        <span className="text-xs text-slate-400">{t("dictation.privacy")}</span>
      )}
      {error ? <span className="w-full text-xs text-red-700">{error}</span> : null}
    </div>
  );
}
