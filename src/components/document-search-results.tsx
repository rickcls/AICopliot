import Link from "next/link";
import { Badge, Card, SectionHeader } from "@/components/ui";
import type { DocumentSearchHit, SearchMatch } from "@/lib/documents/search";
import type { MessageKey, Translate } from "@/lib/i18n/translate";

const MATCH_KEY: Record<SearchMatch, MessageKey> = {
  text: "documents.search.matchText",
  label: "documents.search.matchLabel",
  meaning: "documents.search.matchMeaning",
};

/**
 * Content search results, one line per document with the passage that
 * matched. A literal match is marked inside the snippet; a passage link opens
 * the indexed passage itself rather than the top of the document.
 */
export function DocumentSearchResults({
  query,
  hits,
  t,
}: {
  query: string;
  hits: DocumentSearchHit[];
  t: Translate;
}) {
  return (
    <section aria-label={t("documents.search.label")} className="space-y-2">
      <SectionHeader
        title={
          hits.length === 0
            ? t("documents.search.noResults", { query })
            : t("documents.search.results", { count: hits.length, query })
        }
      >
        <Link href="/documents" className="text-xs font-medium text-slate-500 hover:text-slate-900">
          {t("documents.search.clear")}
        </Link>
      </SectionHeader>
      {hits.length > 0 ? (
        <Card className="divide-y divide-slate-100">
          {hits.map((hit) => (
            <div key={hit.documentId} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Link
                  href={`/documents/${hit.documentId}`}
                  className="min-w-0 truncate text-sm font-medium hover:underline"
                >
                  {hit.title ?? hit.filename}
                </Link>
                <Badge tone={hit.kind === "meaning" ? "neutral" : "info"}>{t(MATCH_KEY[hit.kind])}</Badge>
                <span className="text-xs text-slate-500">
                  {[hit.projectName, hit.pageNumber !== null ? t("documents.search.page", { page: hit.pageNumber }) : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {hit.chunkId ? (
                  <Link
                    href={`/documents/${hit.documentId}/chunks?chunk=${hit.chunkId}#chunk-${hit.chunkId}`}
                    className="ml-auto text-xs font-medium text-slate-500 hover:text-slate-900"
                  >
                    {t("documents.search.openPassage")}
                  </Link>
                ) : null}
              </div>
              {hit.snippet ? (
                <p className="mt-1 text-xs text-pretty text-slate-600">
                  {hit.match ? (
                    <>
                      {hit.snippet.slice(0, hit.match[0])}
                      <mark className="rounded bg-amber-100 px-0.5 text-amber-900">
                        {hit.snippet.slice(hit.match[0], hit.match[1])}
                      </mark>
                      {hit.snippet.slice(hit.match[1])}
                    </>
                  ) : (
                    hit.snippet
                  )}
                </p>
              ) : null}
            </div>
          ))}
        </Card>
      ) : null}
    </section>
  );
}
