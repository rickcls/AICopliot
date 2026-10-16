import "server-only";
import { toTraditional } from "@/lib/language-convert";
import { getTranscriptionProvider, type TranscriptionProvider } from "@/lib/providers";

export const TRANSCRIBE_LANGUAGES = ["yue", "cmn", "en"] as const;
export type TranscribeLanguage = (typeof TRANSCRIBE_LANGUAGES)[number];

/** A 55-second 16 kHz WAV is ~1.8 MB; this leaves headroom without inviting abuse. */
export const MAX_SEGMENT_BYTES = 3 * 1024 * 1024;

const INSTRUCTIONS: Record<TranscribeLanguage, string> = {
  yue: "Transcribe this work voice memo exactly as spoken. The speaker uses Cantonese, possibly mixed with English words. Write the Cantonese in Traditional Chinese characters as used in Hong Kong, including colloquial characters (嘅, 咗, 喺, 佢), and keep English words in English. Do not translate, summarise, correct, or add anything. Return only the transcript.",
  cmn: "Transcribe this work voice memo exactly as spoken. The speaker uses Mandarin, possibly mixed with English words. Write it in Traditional Chinese characters and keep English words in English. Do not translate, summarise, correct, or add anything. Return only the transcript.",
  en: "Transcribe this work voice memo exactly as spoken, in English. Do not summarise, correct, or add anything. Return only the transcript.",
};

/**
 * One segment of a voice memo to text. The audio is passed through and never
 * stored; the transcript goes back into the capture box, where the person
 * reads it before anything is made of it. Chinese output is converted to
 * Traditional as a backstop for the instruction.
 */
export async function transcribeSegment(
  audio: Buffer,
  language: TranscribeLanguage,
  provider: TranscriptionProvider = getTranscriptionProvider(),
): Promise<string> {
  const text = await provider.transcribe(audio, "wav", INSTRUCTIONS[language]);
  return language === "en" ? text : toTraditional(text);
}
