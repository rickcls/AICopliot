import { Card } from "@/components/ui";
import type { Translate } from "@/lib/i18n/translate";
import { cn } from "@/lib/utils";

export const DOCUMENT_CHUNKS_PAGE_SIZE = 5;

export interface DocumentChunkRow {
  id: string;
  chunkIndex: number;
  pageNumber: number | null;
  sectionTitle: string | null;
  content: string;
}

function chunkMeta(chunk: DocumentChunkRow, t: Translate): string {
  const parts = [t("documents.chunks.passage", { index: chunk.chunkIndex + 1 })];
  if (chunk.pageNumber !== null) parts.push(t("documents.chunks.page", { page: chunk.pageNumber }));
  if (chunk.sectionTitle) parts.push(chunk.sectionTitle);
  return parts.join(" · ");
}

/**
 * Each passage carries `id="chunk-{id}"`, so a citation or a search result
 * can link to the passage itself; the one followed is outlined.
 */
export function DocumentChunkList({
  chunks,
  t,
  highlightId = null,
}: {
  chunks: DocumentChunkRow[];
  t: Translate;
  highlightId?: string | null;
}) {
  if (chunks.length === 0) {
    return <p className="text-sm text-sand-500">{t("documents.chunks.none")}</p>;
  }

  return (
    <div className="space-y-2">
      {chunks.map((chunk) => (
        <Card
          key={chunk.id}
          id={`chunk-${chunk.id}`}
          className={cn(
            "scroll-mt-24 p-4",
            chunk.id === highlightId ? "border-amber-300 ring-2 ring-amber-200" : undefined,
          )}
        >
          <p className="text-xs text-sand-500">
            {chunkMeta(chunk, t)}
            {chunk.id === highlightId ? (
              <span className="ml-2 font-medium text-amber-800">{t("documents.chunks.cited")}</span>
            ) : null}
          </p>
          <p className="mt-2 text-sm text-pretty whitespace-pre-wrap text-sand-700">
            {chunk.content}
          </p>
        </Card>
      ))}
    </div>
  );
}
