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
import { Client } from "pg";

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
  const connectionString = process.env.DATABASE_URL;
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
  console.error(`\npgvector index check FAILED:\n  ${(error as Error).message}\n`);
  process.exit(1);
});
