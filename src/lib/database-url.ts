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

function isLocalDatabase(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

/**
 * Pooled host. This is what a request on Vercel should use.
 *
 * A local `.env` copied into a deploy must not hide the Neon URL. When
 * DATABASE_URL points at localhost and an integration URL is also present,
 * the integration URL is the one that can actually be reached.
 */
export function pooledDatabaseUrl(
  env: EnvSource = process.env,
): string | undefined {
  const explicit = firstSet(env, ["DATABASE_URL"]);
  const hosted = firstSet(env, POOLED_KEYS.slice(1));
  if (explicit && hosted && isLocalDatabase(explicit)) return hosted;
  return explicit ?? hosted;
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
