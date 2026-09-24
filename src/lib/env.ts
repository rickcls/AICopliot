import "server-only";
import { z } from "zod";

/**
 * Server-only environment configuration.
 *
 * Validation is *lazy* on purpose. `next build` statically evaluates page
 * modules, and a schema that parsed at import time would fail any build run
 * without a populated .env — turning a missing secret into a build error. Here
 * the first actual read throws instead, so a missing key surfaces as a runtime
 * error in the one request that needs it.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  OPENROUTER_CHAT_MODEL: z.string().default("anthropic/claude-haiku-4.5"),
  OPENROUTER_EMBEDDING_MODEL: z
    .string()
    .default("openai/text-embedding-3-small"),

  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),

  STORAGE_DIR: z.string().default("./storage"),
  // Blank is the same as unset: local disk. A value selects Vercel Blob.
  BLOB_READ_WRITE_TOKEN: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    }),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10_485_760),

  RAG_TOP_K: z.coerce.number().int().positive().max(50).default(8),
  RAG_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.25),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid or missing environment variables:\n${details}\n\nCopy .env.example to .env and fill it in.`,
    );
  }

  cached = parsed.data;
  return cached;
}

/** Test seam: lets unit tests inject config without touching process.env. */
export function __setEnvForTesting(env: Partial<Env> | null): void {
  cached = env ? ({ ...envSchema.parse({ ...process.env, ...env }) } as Env) : null;
}
