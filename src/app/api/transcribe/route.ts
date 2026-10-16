import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { isWav } from "@/lib/audio/wav";
import {
  MAX_SEGMENT_BYTES,
  TRANSCRIBE_LANGUAGES,
  transcribeSegment,
  type TranscribeLanguage,
} from "@/lib/audio/transcribe";

export const maxDuration = 60;

/**
 * Transcribes one WAV segment of a voice memo. The browser splits longer
 * recordings and calls this once per segment, so each request stays well
 * inside the body-size and duration limits.
 */
export async function POST(request: Request) {
  try {
    await requireWorkspace();
    const form = await request.formData();
    const audio = form.get("audio");
    const language = form.get("language");

    if (!(audio instanceof File)) {
      return NextResponse.json({ error: "No recording provided" }, { status: 400 });
    }
    if (audio.size > MAX_SEGMENT_BYTES) {
      return NextResponse.json({ error: "Recording segment is too large" }, { status: 413 });
    }
    if (typeof language !== "string" || !(TRANSCRIBE_LANGUAGES as readonly string[]).includes(language)) {
      return NextResponse.json({ error: "Unknown language" }, { status: 400 });
    }

    const buffer = Buffer.from(await audio.arrayBuffer());
    // The declared type is the browser's word; the bytes are checked too.
    if (!isWav(new Uint8Array(buffer))) {
      return NextResponse.json({ error: "Recording must be a WAV file" }, { status: 400 });
    }

    const text = await transcribeSegment(buffer, language as TranscribeLanguage);
    return NextResponse.json({ text });
  } catch (error) {
    return handleRouteError(error, "POST /api/transcribe");
  }
}
