/**
 * Post-migrate guard for the pgvector index.
 *
 * Prisma cannot see raw-SQL indexes on Unsupported() columns, so every
 * `prisma migrate dev` emits a DROP for the HNSW index. Deleting that DROP by
 * hand works, but it relies on a human remembering on every future migration —
 * and the failure is silent. A dropped index does not break correctness; it
 * turns every vector search into a sequential scan, which you only notice once
 * the corpus is large enough to hurt.
 *
 * This script makes the guarantee automatic instead of remembered. It is
 * idempotent, runs after every migration via `npm run db:migrate`, and exits
 * non-zero if the index could not be ensured.
 *
 * Uses `pg` directly rather than psql, which is not installed on every machine,
 * and works against any Postgres (Docker, Neon, RDS) rather than assuming
 * `docker compose exec`.
 */
import "dotenv/config";
import dns from "node:dns";
import net from "node:net";
import { Client } from "pg";
import { migrationDatabaseUrl } from "../src/lib/database-url";

// Same preference as src/instrumentation.ts. On networks that advertise IPv6
// but cannot route it, pg's default lookup times out before it tries IPv4,
// and the resulting AggregateError has an empty message.
dns.setDefaultResultOrder("ipv4first");
if (typeof net.setDefaultAutoSelectFamily === "function") {
  net.setDefaultAutoSelectFamily(false);
}

const INDEX_NAME = "DocumentChunk_embedding_hnsw_idx";

/**
 * Must stay in sync with the operator used in src/lib/rag/retrieve.ts. If the
 * query uses `<=>` (cosine) and the index is built for a different operator
 * class, Postgres silently ignores the index.
 */
const ENSURE_SQL = `
  CREATE EXTENSION IF NOT EXISTS vector;

  CREATE INDEX IF NOT EXISTS "${INDEX_NAME}"
      ON "DocumentChunk" USING hnsw ("embedding" vector_cosine_ops);
`;

async function main() {
  // Same host as prisma.config.ts, so CREATE INDEX does not run through
  // Neon’s pooler when an unpooled URL is available.
  const connectionString = migrationDatabaseUrl();
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const before = await client.query(
      `SELECT 1 FROM pg_indexes WHERE indexname = $1`,
      [INDEX_NAME],
    );
    const existedBefore = before.rowCount === 1;

    await client.query(ENSURE_SQL);

    const after = await client.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = $1`,
      [INDEX_NAME],
    );

    if (after.rowCount !== 1) {
      throw new Error(
        `Failed to create the pgvector index "${INDEX_NAME}". Vector search would fall back to a sequential scan.`,
      );
    }

    const definition = after.rows[0].indexdef as string;
    if (!definition.includes("vector_cosine_ops")) {
      throw new Error(
        `Index "${INDEX_NAME}" exists but does not use vector_cosine_ops. ` +
          `It will be ignored by the \`<=>\` queries in src/lib/rag/retrieve.ts.`,
      );
    }

    console.log(
      existedBefore
        ? `pgvector index "${INDEX_NAME}" verified.`
        : `pgvector index "${INDEX_NAME}" was missing and has been recreated.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  const err = error as Error & { errors?: Array<{ message?: string }> };
  const detail =
    err.message ||
    err.errors
      ?.map((item) => item.message)
      .filter((message): message is string => Boolean(message))
      .join("; ") ||
    err.name;
  console.error(`\npgvector index check FAILED:\n  ${detail}\n`);
  process.exit(1);
});
