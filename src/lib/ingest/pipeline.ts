import "server-only";
import { prisma, toVectorLiteral } from "@/lib/db";
import { getEmbeddingProvider, type EmbeddingProvider } from "@/lib/providers";
import { getStorage, type StorageProvider } from "@/lib/storage";
import { chunkSections } from "./chunk";
import { extractText } from "./extract";
import type { SupportedKind } from "./validate-upload";

/**
 * Ingestion orchestrator.
 *
 * THIS FUNCTION IS THE QUEUE SEAM. It takes only a document ID and reads
 * everything else from the database and blob storage, so the exact same
 * function body works when invoked from an HTTP route (today) or from an SQS
 * consumer / Lambda handler (later). Nothing above it needs to change.
 *
 * Invariant: `status = 'ready'` is written in the SAME transaction that inserts
 * the chunks and embeddings. A document therefore cannot be reported ready
 * unless its embeddings are durably stored.
 */

const MAX_ERROR_LENGTH = 500;
/** Cached on the Document row for the detail-page preview. */
const PREVIEW_LENGTH = 20_000;
/** Rows per INSERT. Each 1536-d vector literal is ~20KB of text. */
const INSERT_BATCH_SIZE = 100;

export interface IngestionResult {
  documentId: string;
  chunkCount: number;
}

export interface IngestionDeps {
  embeddings?: EmbeddingProvider;
  storage?: StorageProvider;
}

function kindFromMime(mimeType: string, filename: string): SupportedKind {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "docx";
  if (ext === ".csv") return "csv";
  if (ext === ".md" || ext === ".markdown") return "markdown";
  return "text";
}

export async function runIngestion(
  documentId: string,
  deps: IngestionDeps = {},
): Promise<IngestionResult> {
  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document) throw new Error(`Document ${documentId} not found`);

  // Idempotency guard: a duplicate trigger (retry, double-click, redelivered
  // queue message) must not embed the same document twice.
  if (document.status === "processing" || document.status === "ready") {
    return { documentId, chunkCount: document.chunkCount };
  }

  await prisma.document.update({
    where: { id: documentId },
    data: { status: "processing", errorMessage: null },
  });

  try {
    const storage = deps.storage ?? getStorage();
    const embeddings = deps.embeddings ?? getEmbeddingProvider();

    const buffer = await storage.get(document.storageKey);
    const kind = kindFromMime(document.mimeType, document.originalFilename);

    const sections = await extractText(buffer, kind);
    const chunks = chunkSections(sections);

    if (chunks.length === 0) {
      throw new Error("Document produced no text chunks");
    }

    const vectors = await embeddings.embed(chunks.map((c) => c.content));
    if (vectors.length !== chunks.length) {
      throw new Error(
        `Embedding count (${vectors.length}) does not match chunk count (${chunks.length})`,
      );
    }

    const previewText = sections
      .map((s) => s.text)
      .join("\n\n")
      .slice(0, PREVIEW_LENGTH);

    // Chunks + embeddings + the ready flag all land together or not at all.
    await prisma.$transaction(async (tx) => {
      // Clear any partial state from a previous failed attempt.
      await tx.documentChunk.deleteMany({ where: { documentId } });

      // One statement per slice rather than one per chunk: row-at-a-time
      // inserts cost a round trip each, and a long PDF ran past maxDuration.
      // Vector columns are Unsupported() in the schema, so this stays raw SQL;
      // the arrays are still bound parameters, never interpolated.
      for (let start = 0; start < chunks.length; start += INSERT_BATCH_SIZE) {
        const slice = chunks.slice(start, start + INSERT_BATCH_SIZE);
        const ids = slice.map((_, i) => `${documentId}-${start + i}`);
        const vectorLiterals = slice.map((_, i) => toVectorLiteral(vectors[start + i]));

        await tx.$executeRaw`
          INSERT INTO "DocumentChunk"
            ("id", "documentId", "workspaceId", "content", "chunkIndex",
             "pageNumber", "sectionTitle", "embedding", "createdAt")
          SELECT
            r.id, ${documentId}, ${document.workspaceId}, r.content, r.chunk_index,
            r.page_number, r.section_title, r.embedding::vector, NOW()
          FROM unnest(
            ${ids}::text[],
            ${slice.map((c) => c.content)}::text[],
            ${slice.map((c) => c.chunkIndex)}::int[],
            ${slice.map((c) => c.pageNumber)}::int[],
            ${slice.map((c) => c.sectionTitle)}::text[],
            ${vectorLiterals}::text[]
          ) AS r(id, content, chunk_index, page_number, section_title, embedding)`;
      }

      await tx.document.update({
        where: { id: documentId },
        data: {
          status: "ready",
          chunkCount: chunks.length,
          extractedText: previewText,
          errorMessage: null,
        },
      });
    });

    return { documentId, chunkCount: chunks.length };
  } catch (cause) {
    const message = (cause as Error).message ?? "Unknown ingestion error";
    await prisma.document.update({
      where: { id: documentId },
      data: {
        status: "failed",
        errorMessage: message.slice(0, MAX_ERROR_LENGTH),
      },
    });
    throw cause;
  }
}
