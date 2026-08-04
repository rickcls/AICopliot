/**
 * Blob storage abstraction.
 *
 * The local implementation writes under STORAGE_DIR. Moving to S3 later means
 * adding one file that implements this interface and switching the factory in
 * ./index.ts — no call site changes.
 */
export interface StorageProvider {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
