import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { OpenRouterChatProvider } from "@/lib/providers/openrouter";
import { isProviderTimeout, ProviderError } from "@/lib/providers/types";

/**
 * A provider call that never returns would hold the request until Vercel kills
 * it at 60 seconds, and then nothing is saved and the browser cannot say why.
 * The time limit turns that into an error a route can name. The thinking
 * switch lives here too, because models disagree on how to turn it off.
 */

const provider = new OpenRouterChatProvider({
  apiKey: "test-key",
  baseUrl: "https://provider.test",
  model: "test-model",
});
const messages = [{ role: "user" as const, content: "hi" }];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider time limit", () => {
  it("aborts a call that outlasts its limit with a timeout error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          }),
      ),
    );

    const error = await provider.complete(messages, { timeoutMs: 20 }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderError);
    expect(isProviderTimeout(error)).toBe(true);
  });

  it("leaves other failures as ordinary provider errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream broke", { status: 500 })));

    const error = await provider.complete(messages).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderError);
    expect(isProviderTimeout(error)).toBe(false);
  });

  it("falls back to the lowest effort for a model whose thinking cannot be turned off", async () => {
    const mandatory = new OpenRouterChatProvider({
      apiKey: "test-key",
      baseUrl: "https://provider.test",
      model: "thinks-always",
    });
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return body.reasoning?.enabled === false
        ? new Response(
            JSON.stringify({ error: { message: "Reasoning is mandatory for this endpoint and cannot be disabled." } }),
            { status: 400 },
          )
        : new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await mandatory.complete(messages, { reasoning: false });
    await mandatory.complete(messages, { reasoning: false });

    const sent = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1].body)).reasoning);
    // Refused once, then remembered: the second call goes straight to minimal.
    expect(sent).toEqual([{ enabled: false }, { effort: "minimal" }, { effort: "minimal" }]);
  });

  it("sends the switch that turns thinking off", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await provider.complete(messages, { reasoning: false });

    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({
      reasoning: { enabled: false },
    });
  });
});
