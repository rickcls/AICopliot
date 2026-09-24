import { describe, expect, it } from "vitest";
import {
  migrationDatabaseUrl,
  pooledDatabaseUrl,
} from "@/lib/database-url";

describe("database url resolution", () => {
  it("uses DATABASE_URL when that is the only string", () => {
    const env = { DATABASE_URL: "postgres://local/db" };
    expect(pooledDatabaseUrl(env)).toBe("postgres://local/db");
    expect(migrationDatabaseUrl(env)).toBe("postgres://local/db");
  });

  it("reads the Neon integration names when the resource prefix is Storage", () => {
    const env = {
      Storage_DATABASE_URL: "postgres://pooler/db",
      Storage_DATABASE_URL_UNPOOLED: "postgres://direct/db",
    };
    expect(pooledDatabaseUrl(env)).toBe("postgres://pooler/db");
    expect(migrationDatabaseUrl(env)).toBe("postgres://direct/db");
  });

  it("prefers an explicit DATABASE_URL over the integration name", () => {
    const env = {
      DATABASE_URL: "postgres://explicit/db",
      Storage_DATABASE_URL: "postgres://pooler/db",
    };
    expect(pooledDatabaseUrl(env)).toBe("postgres://explicit/db");
  });

  it("treats a blank value as unset", () => {
    const env = {
      DATABASE_URL: "  ",
      Storage_DATABASE_URL: "postgres://pooler/db",
    };
    expect(pooledDatabaseUrl(env)).toBe("postgres://pooler/db");
  });
});
