import "server-only";
import type {
  ChatCompletionOptions,
  ChatMessageInput,
  ChatProvider,
  EmbeddingProvider,
} from "./types";
import { ProviderError } from "./types";

interface OpenRouterConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  dimensions?: number;
}

/** OpenRouter rejects oversized batches; embed in slices. */
const EMBED_BATCH_SIZE = 64;
const EMBED_CONCURRENCY = 3;

async function postJson<T>(
  url: string,
  apiKey: string,
  body: unknown,
): Promise<T> {
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
    });
  } catch (cause) {
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

  return (await response.json()) as T;
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
  choices?: Array<{ message?: { content?: string } }>;
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
    const json = await postJson<ChatResponse>(
      `${this.config.baseUrl}/chat/completions`,
      this.config.apiKey,
      {
        model: this.config.model,
        messages,
        temperature: options.temperature ?? 0,
        max_tokens: options.maxTokens ?? 1200,
        ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
      },
    );

    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new ProviderError("Model returned an empty response");
    }
    return content;
  }
}
