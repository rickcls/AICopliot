import "dotenv/config";
import { defineConfig, env } from "prisma/config";
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
  datasource: {
    url: url || env("DATABASE_URL"),
  },
});
