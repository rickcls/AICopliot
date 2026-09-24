import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { pooledDatabaseUrl } from "@/lib/database-url";

/**
 * Prisma 7 requires a driver adapter (the Rust query engine is gone), so the
 * client is constructed with PrismaPg rather than a datasource URL.
 *
 * Cached on globalThis so Next's dev-mode module reloading doesn't open a new
 * connection pool on every edit.
 */
function createClient(): PrismaClient {
  const connectionString = pooledDatabaseUrl();
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. On Vercel, the Neon integration’s Storage_DATABASE_URL is accepted too.",
    );
  }
  // A serverless instance serves one request at a time. The driver's default
  // pool would open several connections per instance and exhaust Neon.
  const pool =
    process.env.NODE_ENV === "production"
      ? { connectionString, max: 1 }
      : { connectionString };
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Serialises a JS number[] into the pgvector literal format (`[1,2,3]`).
 * Vector columns are `Unsupported()` in the schema, so they are always written
 * and read through raw SQL with this helper.
 */
export function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}
