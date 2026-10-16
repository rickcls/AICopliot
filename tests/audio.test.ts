import { describe, expect, it, vi } from "vitest";
import { encodeWav, isWav, splitSamples, TRANSCRIBE_SAMPLE_RATE } from "@/lib/audio/wav";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getEnv: () => ({}) }));
const { transcribeSegment } = await import("@/lib/audio/transcribe");

describe("WAV encoding", () => {
  it("writes a 16-bit mono PCM header the server recognises", () => {
    const wav = new Uint8Array(encodeWav(new Float32Array([0, 0.5, -0.5, 1]), TRANSCRIBE_SAMPLE_RATE));
    const view = new DataView(wav.buffer);
    expect(isWav(wav)).toBe(true);
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(wav.byteLength).toBe(44 + 4 * 2);
    expect(view.getInt16(44 + 3 * 2, true)).toBe(0x7fff); // 1.0 clamps to max
  });

  it("rejects something that is not a WAV file", () => {
    expect(isWav(new TextEncoder().encode("not audio at all, just text that is long enough"))).toBe(false);
  });

  it("splits a long recording into segments under the request limit", () => {
    const threeMinutes = new Float32Array(TRANSCRIBE_SAMPLE_RATE * 180);
    const segments = splitSamples(threeMinutes, TRANSCRIBE_SAMPLE_RATE, 55);
    expect(segments.map((segment) => segment.length / TRANSCRIBE_SAMPLE_RATE)).toEqual([55, 55, 55, 15]);
    const largest = encodeWav(segments[0], TRANSCRIBE_SAMPLE_RATE).byteLength;
    expect(largest).toBeLessThan(2 * 1024 * 1024);
  });
});

describe("transcribeSegment", () => {
  const audio = Buffer.from("RIFF....WAVE");

  it("asks for Cantonese in Hong Kong characters and enforces Traditional", async () => {
    const provider = { modelName: "audio", transcribe: vi.fn(async () => "聽日要发报价俾ABC") };
    expect(await transcribeSegment(audio, "yue", provider)).toBe("聽日要發報價俾ABC");
    const [, format, instructions] = provider.transcribe.mock.calls[0] as unknown as [Buffer, string, string];
    expect(format).toBe("wav");
    expect(instructions).toContain("Cantonese");
  });

  it("leaves English untouched", async () => {
    const provider = { modelName: "audio", transcribe: vi.fn(async () => "Send the quote tomorrow") };
    expect(await transcribeSegment(audio, "en", provider)).toBe("Send the quote tomorrow");
  });
});
