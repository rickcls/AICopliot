import Link from "next/link";
import { notFound } from "next/navigation";
import {
  DocumentChunkList,
  DOCUMENT_CHUNKS_PAGE_SIZE,
} from "@/components/document-chunks";
import {
  DocumentChunkPageLinks,
  DocumentChunkPagination,
} from "@/components/document-chunk-pagination";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function parsePage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
}

export default async function DocumentChunksPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { workspaceId } = await requireWorkspace();
  const { id } = await params;
  const { page: pageParam } = await searchParams;

  const document = await prisma.document.findFirst({
    where: { id, workspaceId },
    select: {
      id: true,
      originalFilename: true,
      chunkCount: true,
    },
  });

  if (!document) notFound();

  const totalChunks = document.chunkCount;
  const totalPages = Math.max(
    1,
    Math.ceil(totalChunks / DOCUMENT_CHUNKS_PAGE_SIZE),
  );
  const requestedPage = parsePage(pageParam);
  const page = Math.min(requestedPage, totalPages);
  const skip = (page - 1) * DOCUMENT_CHUNKS_PAGE_SIZE;

  const chunks = await prisma.documentChunk.findMany({
    where: { documentId: document.id, workspaceId },
    orderBy: { chunkIndex: "asc" },
    skip,
    take: DOCUMENT_CHUNKS_PAGE_SIZE,
    select: {
      id: true,
      chunkIndex: true,
      pageNumber: true,
      sectionTitle: true,
      content: true,
    },
  });

  const firstChunk = totalChunks === 0 ? 0 : skip + 1;
  const lastChunk = totalChunks === 0 ? 0 : skip + chunks.length;

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Link
        href={`/documents/${document.id}`}
        className="text-sm text-slate-500 hover:text-slate-900"
      >
        ← {document.originalFilename}
      </Link>

      <div className="mt-4">
        <h1 className="text-2xl font-semibold tracking-tight">Indexed chunks</h1>
        <p className="mt-1 text-sm text-slate-500">
          {totalChunks === 0
            ? "Nothing indexed yet."
            : `Showing ${firstChunk}–${lastChunk} of ${totalChunks}`}
        </p>
      </div>

      <section className="mt-8 space-y-4">
        <DocumentChunkList chunks={chunks} />
        <DocumentChunkPagination
          documentId={document.id}
          page={page}
          totalPages={totalPages}
          totalChunks={totalChunks}
        />
        <DocumentChunkPageLinks
          documentId={document.id}
          page={page}
          totalPages={totalPages}
        />
      </section>
    </div>
  );
}
