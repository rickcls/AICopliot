import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Prisma 7 requires a driver adapter (the Rust query engine is gone), so the
 * client is constructed with PrismaPg rather than a datasource URL.
 *
 * Cached on globalThis so Next's dev-mode module reloading doesn't open a new
 * connection pool on every edit.
 */
function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
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
