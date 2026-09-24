import "server-only";
import { getEnv } from "@/lib/env";
import { BlobStorageProvider } from "./blob";
import { LocalStorageProvider } from "./local";
import type { StorageProvider } from "./types";

export type { StorageProvider } from "./types";

let cached: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (!cached) {
    const env = getEnv();
    // Unset means local disk, so `npm run dev` needs no blob store. A token
    // is what Vercel injects once a Blob store is connected to the project.
    cached = env.BLOB_READ_WRITE_TOKEN
      ? new BlobStorageProvider(env.BLOB_READ_WRITE_TOKEN)
      : new LocalStorageProvider(env.STORAGE_DIR);
  }
  return cached;
}
