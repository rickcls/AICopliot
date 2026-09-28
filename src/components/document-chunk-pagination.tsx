import Link from "next/link";
import { buttonClasses, LinkButton } from "@/components/ui";
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
            <LinkButton href={href(page - 1)} variant="secondary" size="sm">
              Previous
            </LinkButton>
          ) : (
            <span
              aria-hidden
              className={buttonClasses({
                variant: "secondary",
                size: "sm",
                className: "pointer-events-none opacity-40",
              })}
            >
              Previous
            </span>
          )}
          {page < totalPages ? (
            <LinkButton href={href(page + 1)} variant="secondary" size="sm">
              Next
            </LinkButton>
          ) : (
            <span
              aria-hidden
              className={buttonClasses({
                variant: "secondary",
                size: "sm",
                className: "pointer-events-none opacity-40",
              })}
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
                buttonClasses({ size: "icon", variant: "ghost" }),
                active
                  ? "bg-slate-900 text-white"
                  : "hover:text-slate-900",
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
