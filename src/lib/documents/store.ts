import "server-only";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { getExtension, validateUpload } from "@/lib/ingest/validate-upload";
import { getStorage } from "@/lib/storage";

/**
 * The one way a file becomes a Document: three-way validation (extension,
 * declared type, magic bytes — invariant 6), a row created first so the
 * storage key can be built from its id, and the bytes written under
 * `{workspaceId}/{documentId}.{ext}`. The upload route and "save a capture as
 * a document" both go through here, so neither can skip a check.
 *
 * The caller has already authorised `projectId` inside the workspace.
 */
export async function storeDocument({
  workspaceId,
  projectId,
  filename,
  mimeType,
  buffer,
}: {
  workspaceId: string;
  projectId: string | null;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<{ ok: true; id: string } | { ok: false; error: string; status: 400 | 413 }> {
  const env = getEnv();
  if (buffer.byteLength > env.MAX_UPLOAD_BYTES) {
    const mb = (env.MAX_UPLOAD_BYTES / 1_048_576).toFixed(1);
    return { ok: false, error: `File exceeds the ${mb} MB limit`, status: 413 };
  }

  const validation = validateUpload({
    filename,
    mimeType,
    sizeBytes: buffer.byteLength,
    head: buffer.subarray(0, 8),
    maxBytes: env.MAX_UPLOAD_BYTES,
  });
  if (!validation.ok) return { ok: false, error: validation.error, status: 400 };

  // The user's filename never appears in a storage path.
  const document = await prisma.document.create({
    data: {
      workspaceId,
      projectId,
      originalFilename: validation.safeFilename,
      mimeType: mimeType || "application/octet-stream",
      sizeBytes: buffer.byteLength,
      storageKey: "pending",
      status: "uploaded",
    },
  });

  const storageKey = `${workspaceId}/${document.id}${getExtension(validation.safeFilename)}`;
  try {
    await getStorage().put(storageKey, buffer, document.mimeType);
  } catch (cause) {
    // Don't leave a row pointing at a file that was never written.
    await prisma.document.delete({ where: { id: document.id } });
    throw cause;
  }

  await prisma.document.update({ where: { id: document.id }, data: { storageKey } });
  return { ok: true, id: document.id };
}
