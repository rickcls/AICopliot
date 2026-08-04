import "server-only";
import { getEnv } from "@/lib/env";
import {
  OpenRouterChatProvider,
  OpenRouterEmbeddingProvider,
} from "./openrouter";
import type { ChatProvider, EmbeddingProvider } from "./types";

export type { ChatProvider, EmbeddingProvider } from "./types";
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
