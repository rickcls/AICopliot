/**
 * Turns recorded audio into WAV segments the transcription model accepts.
 *
 * Browsers record in different containers (Chrome: webm/opus, Safari: mp4),
 * and OpenRouter accepts neither webm nor raw PCM in a container it can read
 * from every browser — so the page decodes the recording, downmixes it to
 * 16 kHz mono, and encodes plain 16-bit WAV here. At 16 kHz a 55-second
 * segment is about 1.8 MB, under Vercel's 4.5 MB request limit with room for
 * the request around it, and short enough to transcribe inside 60 seconds.
 *
 * Pure: no DOM, no audio APIs, so it is tested directly.
 */

export const TRANSCRIBE_SAMPLE_RATE = 16_000;
export const MAX_SEGMENT_SECONDS = 55;

/** Splits samples into segments of at most `maxSeconds`. */
export function splitSamples(
  samples: Float32Array,
  sampleRate: number,
  maxSeconds = MAX_SEGMENT_SECONDS,
): Float32Array[] {
  const size = Math.max(1, Math.floor(sampleRate * maxSeconds));
  const segments: Float32Array[] = [];
  for (let start = 0; start < samples.length; start += size) {
    segments.push(samples.subarray(start, Math.min(samples.length, start + size)));
  }
  return segments;
}

/** 16-bit PCM WAV, mono. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return buffer;
}

/** The server's check that an upload really is a WAV file. */
export function isWav(bytes: Uint8Array): boolean {
  const text = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  return bytes.length > 44 && text(0, 4) === "RIFF" && text(8, 12) === "WAVE";
}
