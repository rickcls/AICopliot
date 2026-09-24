import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Neon’s pooler rejects some migration statements. DIRECT_URL is the
// non-pooled host; local Docker only has DATABASE_URL.
const directUrl = process.env.DIRECT_URL?.trim();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: directUrl || env("DATABASE_URL"),
  },
});
