import Link from "next/link";
import { buttonClasses, LinkButton } from "@/components/ui";
import type { Translate } from "@/lib/i18n/translate";
import { cn } from "@/lib/utils";

export function DocumentChunkPagination({
  documentId,
  page,
  totalPages,
  totalChunks,
  t,
}: {
  documentId: string;
  page: number;
  totalPages: number;
  totalChunks: number;
  t: Translate;
}) {
  const href = (nextPage: number) =>
    `/documents/${documentId}/chunks?page=${nextPage}`;

  return (
    <nav
      aria-label={t("documents.chunks.pages")}
      className="flex flex-wrap items-center justify-between gap-3 border-t border-sand-100 pt-4"
    >
      <p className="text-sm text-sand-500">
        {totalPages > 1 ? <>{t("documents.chunks.pageOf", { page, total: totalPages })} · </> : null}
        {t("documents.chunks.count", { count: totalChunks })}
      </p>

      {totalPages > 1 ? (
        <div className="flex items-center gap-2">
          {page > 1 ? (
            <LinkButton href={href(page - 1)} variant="secondary" size="sm">
              {t("documents.chunks.previous")}
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
              {t("documents.chunks.previous")}
            </span>
          )}
          {page < totalPages ? (
            <LinkButton href={href(page + 1)} variant="secondary" size="sm">
              {t("documents.chunks.next")}
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
              {t("documents.chunks.next")}
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
                  ? "bg-sand-900 text-white"
                  : "hover:text-sand-900",
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
