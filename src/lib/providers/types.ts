/**
 * Model provider abstraction.
 *
 * The rest of the app depends only on these two interfaces, so swapping models
 * is an env change and swapping vendors is one new file implementing them.
 * Nothing here is OpenRouter-specific.
 */

export interface EmbeddingProvider {
  /** Model identifier, recorded in logs so answers are traceable to a model. */
  readonly modelName: string;
  /** Dimension of the returned vectors; must match the pgvector column. */
  readonly dimensions: number;
  /** Embeds a batch. Returns one vector per input, in the same order. */
  embed(texts: string[]): Promise<number[][]>;
}

export interface ChatMessageInput {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider to constrain output to a JSON object. */
  jsonMode?: boolean;
}

export interface ChatProvider {
  readonly modelName: string;
  complete(
    messages: ChatMessageInput[],
    options?: ChatCompletionOptions,
  ): Promise<string>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
