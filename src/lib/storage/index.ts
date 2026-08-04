import "server-only";
import { getEnv } from "@/lib/env";
import { LocalStorageProvider } from "./local";
import type { StorageProvider } from "./types";

export type { StorageProvider } from "./types";

let cached: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (!cached) {
    cached = new LocalStorageProvider(getEnv().STORAGE_DIR);
  }
  return cached;
}
