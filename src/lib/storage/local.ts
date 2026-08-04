import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { StorageProvider } from "./types";

/**
 * Local-disk storage. Keys are generated server-side (workspaceId/documentId.ext)
 * and never derived from user input, but resolve() is still checked against the
 * root so a malformed key cannot escape the storage directory.
 */
export class LocalStorageProvider implements StorageProvider {
  constructor(private readonly rootDir: string) {}

  private resolve(key: string): string {
    const root = path.resolve(this.rootDir);
    const full = path.resolve(root, key);
    if (full !== root && !full.startsWith(root + path.sep)) {
      throw new Error("Invalid storage key: resolves outside the storage root");
    }
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(key));
    } catch (err) {
      // Deleting an already-absent object is a success, not an error: the DB
      // row must still be removable if the file vanished.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}
