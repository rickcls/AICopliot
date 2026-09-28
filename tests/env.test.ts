import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { __setEnvForTesting, getEnv, withoutBlankValues } from "@/lib/env";

describe("withoutBlankValues", () => {
  it("drops empty and whitespace-only values and keeps the rest", () => {
    expect(
      withoutBlankValues({ A: "", B: "   ", C: undefined, D: "0", E: "x" }),
    ).toEqual({ D: "0", E: "x" });
  });
});

describe("getEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    __setEnvForTesting(null);
  });

  // Vercel keeps a variable whose value was cleared; coercing "" gave 0 and
  // failed every route with "expected number to be >0".
  it("applies defaults to variables that are present but blank", () => {
    vi.stubEnv("DATABASE_URL", "postgres://example");
    vi.stubEnv("OPENROUTER_API_KEY", "key");
    vi.stubEnv("EMBEDDING_DIMENSIONS", "");
    vi.stubEnv("MAX_UPLOAD_BYTES", "");
    vi.stubEnv("RAG_TOP_K", " ");
    vi.stubEnv("RAG_MIN_SCORE", "");
    __setEnvForTesting(null);

    const env = getEnv();
    expect(env.EMBEDDING_DIMENSIONS).toBe(1536);
    expect(env.MAX_UPLOAD_BYTES).toBe(10_485_760);
    expect(env.RAG_TOP_K).toBe(8);
    expect(env.RAG_MIN_SCORE).toBe(0.25);
  });
});
