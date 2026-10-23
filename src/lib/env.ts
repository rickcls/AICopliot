import "server-only";
import { z } from "zod";
import { pooledDatabaseUrl } from "@/lib/database-url";

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
  // Optional: a stronger model for writing in the person's own voice (email
  // drafts). Unset, the chat model writes them too.
  OPENROUTER_WRITING_MODEL: z.string().optional(),
  // Voice memos need a model that accepts audio input. The default is the
  // model OpenRouter's own audio documentation uses in its examples.
  OPENROUTER_TRANSCRIBE_MODEL: z.string().default("google/gemini-2.5-flash"),

  // Read-only Gmail. All three must be set, or Gmail is simply not offered.
  // The key is 32 random bytes, base64 (openssl rand -base64 32).
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** Outlook (Microsoft Graph, read-only). One app registration for company and personal accounts. */
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  INTEGRATION_ENCRYPTION_KEY: z.string().optional(),
  // The public origin Google redirects back to. Unset, the request's own
  // origin is used — fine for one domain, but every preview URL would need
  // registering with Google.
  APP_URL: z.string().url().optional(),

  // Optional. Both must be set before a password-reset email (or a later
  // alert) can leave the server. Unset, production refuses and development
  // prints the message in the server log.
  RESEND_API_KEY: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    }),
  EMAIL_FROM: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    }),

  // Optional. Unset, the assistant's web-search switch stays disabled.
  TAVILY_API_KEY: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    }),

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

/**
 * Treat a blank variable as unset. Vercel keeps a variable whose value was
 * cleared, and `z.coerce.number()` turns "" into 0: `.default()` never runs,
 * so MAX_UPLOAD_BYTES fails `.positive()` and every route that reads the env
 * breaks — worse, a blank RAG_MIN_SCORE passes as 0 and silently disables the
 * refusal threshold.
 */
export function withoutBlankValues(
  source: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value?.trim()),
  );
}

/**
 * Neon’s Vercel integration stores the pooled URL under Storage_DATABASE_URL
 * when the resource is named Storage. Copy it onto DATABASE_URL so the rest
 * of this schema can keep a single required field.
 */
function withPooledDatabaseUrl(
  source: Record<string, string | undefined>,
): Record<string, string | undefined> {
  if (source.DATABASE_URL?.trim()) return source;
  const pooled = pooledDatabaseUrl(source);
  return pooled ? { ...source, DATABASE_URL: pooled } : source;
}

export function getEnv(): Env {
  // Next reloads `.env` into this process during development. Keeping the first
  // parse would ignore that, so a key added while the server is running would
  // never be seen and password reset would keep logging the link.
  if (cached && process.env.NODE_ENV === "production") return cached;

  const parsed = envSchema.safeParse(
    withPooledDatabaseUrl(withoutBlankValues(process.env)),
  );
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
  cached = env
    ? ({
        ...envSchema.parse(
          withPooledDatabaseUrl(
            withoutBlankValues({
              ...process.env,
              ...(env as Record<string, string | undefined>),
            }),
          ),
        ),
      } as Env)
    : null;
}
