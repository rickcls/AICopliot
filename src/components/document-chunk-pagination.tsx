import Link from "next/link";
import { cn } from "@/lib/utils";

export function DocumentChunkPagination({
  documentId,
  page,
  totalPages,
  totalChunks,
}: {
  documentId: string;
  page: number;
  totalPages: number;
  totalChunks: number;
}) {
  const href = (nextPage: number) =>
    `/documents/${documentId}/chunks?page=${nextPage}`;

  return (
    <nav
      aria-label="Chunk pages"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"
    >
      <p className="text-sm text-slate-500">
        {totalPages > 1 ? (
          <>
            Page {page} of {totalPages} ·{" "}
          </>
        ) : null}
        {totalChunks} chunk{totalChunks === 1 ? "" : "s"}
      </p>

      {totalPages > 1 ? (
        <div className="flex items-center gap-2">
          {page > 1 ? (
            <Link
              href={href(page - 1)}
              className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium hover:bg-slate-50"
            >
              Previous
            </Link>
          ) : (
            <span
              aria-hidden
              className="inline-flex h-8 items-center rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-300"
            >
              Previous
            </span>
          )}
          {page < totalPages ? (
            <Link
              href={href(page + 1)}
              className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium hover:bg-slate-50"
            >
              Next
            </Link>
          ) : (
            <span
              aria-hidden
              className="inline-flex h-8 items-center rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-300"
            >
              Next
            </span>
          )}
        </div>
      ) : null}
    </nav>
  );
}

export function DocumentChunkPageLinks({
  documentId,
  page,
  totalPages,
}: {
  documentId: string;
  page: number;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;

  return (
    <ol className="mt-4 flex flex-wrap gap-1">
      {Array.from({ length: totalPages }, (_, index) => {
        const pageNumber = index + 1;
        const active = pageNumber === page;
        return (
          <li key={pageNumber}>
            <Link
              href={`/documents/${documentId}/chunks?page=${pageNumber}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex size-8 items-center justify-center rounded-lg text-sm font-medium transition-colors",
                active
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              {pageNumber}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
