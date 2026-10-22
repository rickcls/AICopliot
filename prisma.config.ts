import "dotenv/config";
import { defineConfig } from "prisma/config";
import { migrationDatabaseUrl } from "./src/lib/database-url";

// Prefer the non-pooled Neon host (DIRECT_URL or Storage_DATABASE_URL_UNPOOLED).
// Local Docker only has DATABASE_URL, so that remains the fallback.
const url = migrationDatabaseUrl();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // Only when there is a connection string. `prisma generate` — the first step
  // of `npm run build` — needs no database, and requiring one here failed every
  // build that had none (`env("DATABASE_URL")` throws). Migrate and introspect
  // still refuse without it, with Prisma's own message.
  ...(url ? { datasource: { url } } : {}),
});
