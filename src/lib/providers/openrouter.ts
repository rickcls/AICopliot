import "server-only";
import type {
  ChatCompletionOptions,
  ChatMessageInput,
  ChatProvider,
  EmbeddingProvider,
  TranscriptionProvider,
} from "./types";
import { PROVIDER_TIMEOUT_STATUS, ProviderError } from "./types";

interface OpenRouterConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  dimensions?: number;
}

/** OpenRouter rejects oversized batches; embed in slices. */
const EMBED_BATCH_SIZE = 64;
const EMBED_CONCURRENCY = 3;

/**
 * Every call ends by this time unless the caller asks for less. Vercel stops a
 * function at 60 seconds without a response, which the browser can only report
 * as "failed before it was saved"; an aborted call is an error a route can name.
 */
const DEFAULT_TIMEOUT_MS = 45_000;

function isTimeout(error: unknown) {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function timeoutError(timeoutMs: number) {
  return new ProviderError(
    `Model provider did not answer within ${Math.round(timeoutMs / 1000)}s`,
    PROVIDER_TIMEOUT_STATUS,
  );
}

async function postJson<T>(
  url: string,
  apiKey: string,
  body: unknown,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  // The signal also covers reading the body, so a stalled stream aborts too.
  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // Optional OpenRouter attribution headers.
        "X-Title": "ScopePilot",
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    if (isTimeout(cause)) throw timeoutError(timeoutMs);
    const err = cause as Error & { cause?: { code?: string } };
    const detail = err.cause?.code ? `${err.message} (${err.cause.code})` : err.message;
    throw new ProviderError(`Could not reach the model provider: ${detail}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new ProviderError(
      `Model provider returned ${response.status}: ${text.slice(0, 500)}`,
      response.status,
    );
  }

  try {
    return (await response.json()) as T;
  } catch (cause) {
    if (isTimeout(cause)) throw timeoutError(timeoutMs);
    throw cause;
  }
}

interface EmbeddingsResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

export class OpenRouterEmbeddingProvider implements EmbeddingProvider {
  readonly modelName: string;
  readonly dimensions: number;

  constructor(private readonly config: OpenRouterConfig) {
    this.modelName = config.model;
    this.dimensions = config.dimensions ?? 1536;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const batches: string[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      batches.push(texts.slice(i, i + EMBED_BATCH_SIZE));
    }

    // A few batches in flight at once: strictly sequential batches made a long
    // document spend most of its time budget waiting on the network.
    const out: number[][] = [];
    for (let i = 0; i < batches.length; i += EMBED_CONCURRENCY) {
      const results = await Promise.all(
        batches.slice(i, i + EMBED_CONCURRENCY).map((batch) => this.embedBatch(batch)),
      );
      for (const vectors of results) out.push(...vectors);
    }

    return out;
  }

  private async embedBatch(batch: string[]): Promise<number[][]> {
    const json = await postJson<EmbeddingsResponse>(
      `${this.config.baseUrl}/embeddings`,
      this.config.apiKey,
      {
        model: this.config.model,
        input: batch,
        // Gemini Embedding 2 defaults to 3072; the DB column is fixed-width.
        dimensions: this.dimensions,
      },
    );

    if (!Array.isArray(json.data) || json.data.length !== batch.length) {
      throw new ProviderError(
        `Embedding provider returned ${json.data?.length ?? 0} vectors for ${batch.length} inputs`,
      );
    }

    // The API may return results out of order; `index` is authoritative.
    const ordered = [...json.data].sort((a, b) => a.index - b.index);
    return ordered.map((item) => {
      if (item.embedding.length !== this.dimensions) {
        throw new ProviderError(
          `Embedding model "${this.config.model}" returned ${item.embedding.length} dimensions but the database column expects ${this.dimensions}. ` +
            `Set EMBEDDING_DIMENSIONS to match and re-run migrations.`,
        );
      }
      return item.embedding;
    });
  }
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
}

/**
 * Models whose thinking cannot be switched off. OpenRouter refuses
 * `reasoning: { enabled: false }` for them with a 400 but accepts the lowest
 * effort, which spent no thinking tokens on GLM 5.3 Flash. The off switch is
 * still tried first because the lowest effort is not off everywhere: DeepSeek
 * V4 Flash kept thinking at it, and was slower.
 */
const mandatoryReasoning = new Set<string>();

function isReasoningMandatory(error: unknown) {
  return (
    error instanceof ProviderError &&
    error.status === 400 &&
    /reasoning is mandatory/i.test(error.message)
  );
}

export class OpenRouterChatProvider implements ChatProvider {
  readonly modelName: string;

  constructor(private readonly config: OpenRouterConfig) {
    this.modelName = config.model;
  }

  async complete(
    messages: ChatMessageInput[],
    options: ChatCompletionOptions = {},
  ): Promise<string> {
    const { model } = this.config;
    const send = () =>
      postJson<ChatResponse>(
        `${this.config.baseUrl}/chat/completions`,
        this.config.apiKey,
        {
          model,
          messages,
          temperature: options.temperature ?? 0,
          max_tokens: options.maxTokens ?? 1200,
          ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
          ...(options.reasoning === false
            ? {
                reasoning: mandatoryReasoning.has(model)
                  ? { effort: "minimal" }
                  : { enabled: false },
              }
            : {}),
        },
        options.timeoutMs,
      );

    let json: ChatResponse;
    try {
      json = await send();
    } catch (error) {
      if (options.reasoning !== false || mandatoryReasoning.has(model) || !isReasoningMandatory(error)) {
        throw error;
      }
      mandatoryReasoning.add(model);
      json = await send();
    }

    const choice = json.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      // "length" here means a reasoning model spent the whole max_tokens budget
      // thinking and never wrote an answer — a budget problem, not an outage,
      // and the log should say which.
      throw new ProviderError(
        `Model returned an empty response (finish_reason: ${choice?.finish_reason ?? "unknown"})`,
      );
    }
    return content;
  }
}

/**
 * Transcription through an audio-capable chat model: OpenRouter takes audio as
 * an `input_audio` content part, base64-encoded (no URLs). The formats it
 * documents are wav, mp3, aiff, aac, ogg, flac, m4a, pcm16, and pcm24 — not
 * webm, which is why the browser converts a recording to WAV first.
 */
export class OpenRouterTranscriptionProvider implements TranscriptionProvider {
  readonly modelName: string;

  constructor(private readonly config: OpenRouterConfig) {
    this.modelName = config.model;
  }

  async transcribe(audio: Buffer, format: "wav", instructions: string): Promise<string> {
    const json = await postJson<ChatResponse>(
      `${this.config.baseUrl}/chat/completions`,
      this.config.apiKey,
      {
        model: this.config.model,
        temperature: 0,
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: instructions },
              { type: "input_audio", input_audio: { data: audio.toString("base64"), format } },
            ],
          },
        ],
      },
    );
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new ProviderError("Transcription returned no text");
    }
    return content.trim();
  }
}
