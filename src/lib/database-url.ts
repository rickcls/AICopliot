/**
 * Connection strings this app will accept.
 *
 * Local Docker and a hand-set Vercel env use DATABASE_URL. The Neon integration
 * names the resource "Storage", so Vercel injects the same strings as
 * Storage_DATABASE_URL and Storage_DATABASE_URL_UNPOOLED. POSTGRES_* is the
 * older Vercel Postgres template name for that same pair.
 */

type EnvSource = Record<string, string | undefined>;

function firstSet(env: EnvSource, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

const POOLED_KEYS = [
  "DATABASE_URL",
  "Storage_DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
] as const;

const DIRECT_KEYS = [
  "DIRECT_URL",
  "Storage_DATABASE_URL_UNPOOLED",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
] as const;

/** Pooled host. This is what a request on Vercel should use. */
export function pooledDatabaseUrl(
  env: EnvSource = process.env,
): string | undefined {
  return firstSet(env, POOLED_KEYS);
}

/**
 * Direct host for migrations and the vector index. Falls back to the pooled
 * URL so local Docker, which has only DATABASE_URL, still migrates.
 */
export function migrationDatabaseUrl(
  env: EnvSource = process.env,
): string | undefined {
  return firstSet(env, DIRECT_KEYS) ?? pooledDatabaseUrl(env);
}
