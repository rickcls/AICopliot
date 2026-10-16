import "server-only";
import { getEnv } from "@/lib/env";
import {
  OpenRouterChatProvider,
  OpenRouterEmbeddingProvider,
  OpenRouterTranscriptionProvider,
} from "./openrouter";
import type { ChatProvider, EmbeddingProvider, TranscriptionProvider } from "./types";

export type { ChatProvider, EmbeddingProvider, TranscriptionProvider } from "./types";
export { ProviderError } from "./types";

/**
 * Factory seam. Call sites take providers as arguments wherever practical so
 * tests can inject fakes; these helpers are the production default.
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  const env = getEnv();
  return new OpenRouterEmbeddingProvider({
    apiKey: env.OPENROUTER_API_KEY,
    baseUrl: env.OPENROUTER_BASE_URL,
    model: env.OPENROUTER_EMBEDDING_MODEL,
    dimensions: env.EMBEDDING_DIMENSIONS,
  });
}

export function getChatProvider(): ChatProvider {
  const env = getEnv();
  return new OpenRouterChatProvider({
    apiKey: env.OPENROUTER_API_KEY,
    baseUrl: env.OPENROUTER_BASE_URL,
    model: env.OPENROUTER_CHAT_MODEL,
  });
}

/**
 * The model that writes in the person's voice. Tone is where a small, cheap
 * model shows first, so this can point at a stronger one without moving every
 * other feature onto it.
 */
export function getWritingProvider(): ChatProvider {
  const env = getEnv();
  return new OpenRouterChatProvider({
    apiKey: env.OPENROUTER_API_KEY,
    baseUrl: env.OPENROUTER_BASE_URL,
    model: env.OPENROUTER_WRITING_MODEL ?? env.OPENROUTER_CHAT_MODEL,
  });
}

/** Voice memos. Needs a model that accepts audio input. */
export function getTranscriptionProvider(): TranscriptionProvider {
  const env = getEnv();
  return new OpenRouterTranscriptionProvider({
    apiKey: env.OPENROUTER_API_KEY,
    baseUrl: env.OPENROUTER_BASE_URL,
    model: env.OPENROUTER_TRANSCRIBE_MODEL,
  });
}
