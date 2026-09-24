import "server-only";
import { del, get, put } from "@vercel/blob";
import type { StorageProvider } from "./types";

/**
 * Vercel Blob storage. The pathname is the same server-built key the local
 * provider writes (`{workspaceId}/{documentId}.{ext}`), so a row's storageKey
 * still names the object.
 *
 * Reads skip the CDN cache. Ingestion fetches the file in the request right
 * after it was stored, and a cached miss would fail that read.
 */
export class BlobStorageProvider implements StorageProvider {
  constructor(private readonly token: string) {}

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    await put(key, data, {
      access: "private",
      token: this.token,
      contentType,
      // The database stores this exact key. A random suffix would make the
      // next read look up a path that was never written down.
      addRandomSuffix: false,
    });
  }

  async get(key: string): Promise<Buffer> {
    const result = await get(key, {
      access: "private",
      token: this.token,
      useCache: false,
    });
    if (!result || result.statusCode !== 200) {
      throw new Error(`Stored file not found: ${key}`);
    }
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    // del resolves when the pathname is already gone, matching the local
    // provider: a missing file must not block deleting the database row.
    await del(key, { token: this.token });
  }
}
