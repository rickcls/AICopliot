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
        "X-Title": "AI Ops Copilot",
      },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new ProviderError(
      `Could not reach the model provider: ${(cause as Error).message}`,
    );
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

    const out: number[][] = [];

    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
      const json = await postJson<EmbeddingsResponse>(
        `${this.config.baseUrl}/embeddings`,
        this.config.apiKey,
        { model: this.config.model, input: batch },
      );

      if (!Array.isArray(json.data) || json.data.length !== batch.length) {
        throw new ProviderError(
          `Embedding provider returned ${json.data?.length ?? 0} vectors for ${batch.length} inputs`,
        );
      }

      // The API may return results out of order; `index` is authoritative.
      const ordered = [...json.data].sort((a, b) => a.index - b.index);
      for (const item of ordered) {
        if (item.embedding.length !== this.dimensions) {
          throw new ProviderError(
            `Embedding model "${this.config.model}" returned ${item.embedding.length} dimensions but the database column expects ${this.dimensions}. ` +
              `Set EMBEDDING_DIMENSIONS to match and re-run migrations.`,
          );
        }
        out.push(item.embedding);
      }
    }

    return out;
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
