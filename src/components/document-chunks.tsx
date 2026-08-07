import { Card } from "@/components/ui";

export const DOCUMENT_CHUNKS_PAGE_SIZE = 5;

export interface DocumentChunkRow {
  id: string;
  chunkIndex: number;
  pageNumber: number | null;
  sectionTitle: string | null;
  content: string;
}

function chunkMeta(chunk: DocumentChunkRow): string {
  const parts = [`Chunk ${chunk.chunkIndex}`];
  if (chunk.pageNumber !== null) parts.push(`page ${chunk.pageNumber}`);
  if (chunk.sectionTitle) parts.push(chunk.sectionTitle);
  return parts.join(" · ");
}

export function DocumentChunkList({ chunks }: { chunks: DocumentChunkRow[] }) {
  if (chunks.length === 0) {
    return (
      <p className="text-sm text-slate-500">No chunks indexed for this document.</p>
    );
  }

  return (
    <div className="space-y-2">
      {chunks.map((chunk) => (
        <Card key={chunk.id} className="p-4">
          <p className="text-xs text-slate-500">{chunkMeta(chunk)}</p>
          <p className="mt-2 text-sm text-pretty whitespace-pre-wrap text-slate-700">
            {chunk.content}
          </p>
        </Card>
      ))}
    </div>
  );
}
