import { Search } from "lucide-react";
import { DocumentSearchResults } from "@/components/document-search-results";
import { DocumentsPanel } from "@/components/documents-panel";
import { Button, Input } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { MIN_QUERY_LENGTH, searchDocuments } from "@/lib/documents/search";
import { documentRowSelect, toDocumentRow } from "@/lib/documents/select";
import { getT } from "@/lib/i18n/server";
import { visibleProjectWhere } from "@/lib/pm/visibility";

export const dynamic = "force-dynamic";

/**
 * Every document in the workspace: search inside them, upload, label, and
 * file them under projects.
 *
 * Content search is a plain GET form (`?q=`), so a search is a link that can
 * be shared or reopened, and works before any script has loaded.
 */
export default async function AllDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; q?: string }>;
}) {
  const access = await requireWorkspace();
  const { workspaceId, userId } = access;
  const { project: requestedProjectId, q } = await searchParams;
  const query = q?.trim() ?? "";

  const [t, documents, projects, hits] = await Promise.all([
    getT(),
    prisma.document.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      select: documentRowSelect,
    }),
    prisma.project.findMany({
      where: visibleProjectWhere(workspaceId, userId),
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    query.length >= MIN_QUERY_LENGTH ? searchDocuments(access, query) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("documents.title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">{t("documents.lead")}</p>
      </div>

      <form action="/documents" method="get" role="search" className="flex max-w-2xl gap-2">
        <label htmlFor="document-search" className="sr-only">
          {t("documents.search.label")}
        </label>
        <Input
          id="document-search"
          name="q"
          type="search"
          defaultValue={query}
          placeholder={t("documents.search.placeholder")}
          className="min-w-0 flex-1"
        />
        <Button type="submit">
          <Search className="size-4" aria-hidden />
          {t("documents.search.submit")}
        </Button>
      </form>

      {query && query.length < MIN_QUERY_LENGTH ? (
        <p className="text-sm text-slate-500">{t("documents.search.tooShort")}</p>
      ) : null}
      {hits ? <DocumentSearchResults query={query} hits={hits} t={t} /> : null}

      <DocumentsPanel
        projects={projects}
        initialProjectFilter={
          requestedProjectId && projects.some((project) => project.id === requestedProjectId)
            ? requestedProjectId
            : "all"
        }
        initialDocuments={documents.map(toDocumentRow)}
      />
    </div>
  );
}
