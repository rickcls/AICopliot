import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { DeleteDocumentButton } from "@/components/delete-document-button";
import { DocumentLabels } from "@/components/document-labels";
import { RetryIngestionButton } from "@/components/retry-ingestion-button";
import { Badge, Card, LinkButton, PageHeader, SectionHeader } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { intlLocale } from "@/lib/i18n/locales";
import { getViewerTimeZone } from "@/lib/viewer";
import { getLocale, getT } from "@/lib/i18n/server";
import { formatBytes, formatInstantDay } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_TONE = {
  uploaded: "info",
  processing: "warning",
  ready: "success",
  failed: "danger",
} as const;

const PREVIEW_CHARS = 5000;

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { workspaceId } = await requireWorkspace();
  const { id } = await params;
  const [t, locale, timeZone] = await Promise.all([getT(), getLocale(), getViewerTimeZone()]);
  const dateLocale = intlLocale(locale);

  // Scoped by workspaceId: an ID from another workspace 404s rather than leaking.
  const document = await prisma.document.findFirst({
    where: { id, workspaceId },
    include: { project: { select: { name: true } } },
  });

  if (!document) notFound();
  const name = document.title ?? document.originalFilename;

  return (
    // Extracted document text is prose; cap the width so lines stay readable.
    <div className="mx-auto w-full max-w-4xl">
      <Link href="/documents" className="inline-flex items-center gap-1 text-sm text-sand-500 hover:text-sand-900">
        ← {t("documents.detail.back")}
      </Link>

      <PageHeader
        className="mt-3 mb-0"
        // A filename can be one unbroken word; let it wrap rather than overflow.
        title={<span className="break-words">{name}</span>}
        lead={
          <>
            {document.title ? `${document.originalFilename} · ` : null}
            {t("documents.detail.uploaded", {
              size: formatBytes(document.sizeBytes),
              date: formatInstantDay(document.createdAt, dateLocale, timeZone),
            })}
          </>
        }
        actions={
          <>
            {document.status !== "ready" ? (
              <Badge tone={STATUS_TONE[document.status]}>
                {t(`documents.status.${document.status}`)}
              </Badge>
            ) : (
              <LinkButton href={`/chat?docs=${document.id}`} variant="secondary" size="sm">
                <MessageSquare className="size-4" aria-hidden />
                {t("documents.detail.ask")}
              </LinkButton>
            )}
            {document.status === "failed" ? <RetryIngestionButton id={document.id} /> : null}
            <DeleteDocumentButton id={document.id} filename={name} />
          </>
        }
      />

      {document.status === "failed" && document.errorMessage ? (
        <div role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-medium text-red-800">{t("documents.detail.failedTitle")}</p>
          <p className="mt-1 text-sm text-red-700">{document.errorMessage}</p>
        </div>
      ) : null}

      <section className="mt-6 space-y-3">
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-sand-900">{t("documents.detail.summary")}</h2>
          {document.summary ? (
            <>
              <p className="mt-2 text-sm text-pretty text-sand-700">{document.summary}</p>
              <p className="mt-2 text-xs text-sand-400">{t("documents.detail.summaryHint")}</p>
            </>
          ) : (
            <p className="mt-2 text-sm text-sand-500">{t("documents.detail.noSummary")}</p>
          )}
        </Card>
        <DocumentLabels
          documentId={document.id}
          ready={document.status === "ready"}
          title={document.title}
          docType={document.docType}
          tags={document.tags}
          labelSource={document.labelSource}
        />
      </section>

      <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: t("documents.detail.project"), value: document.project?.name ?? t("documents.unassigned") },
          { label: t("documents.detail.passagesIndexed"), value: String(document.chunkCount) },
          { label: t("documents.detail.contentType"), value: document.mimeType || "—" },
          { label: t("documents.detail.updated"), value: formatInstantDay(document.updatedAt, dateLocale, timeZone) },
        ].map((item) => (
          <div key={item.label}>
            <dt className="text-xs text-sand-500">{item.label}</dt>
            <dd className="mt-0.5 truncate text-sm font-medium" title={item.value}>
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      {document.chunkCount > 0 ? (
        <section className="mt-8">
          <LinkButton href={`/documents/${document.id}/chunks`} variant="secondary">
            {t("documents.detail.reviewPassages", { count: document.chunkCount })}
          </LinkButton>
        </section>
      ) : null}

      {document.extractedText ? (
        <section className="mt-8">
          <SectionHeader
            title={t("documents.detail.preview")}
            description={
              document.extractedText.length > PREVIEW_CHARS
                ? t("documents.detail.previewHint")
                : undefined
            }
          />
          <Card className="mt-3 max-h-96 overflow-auto p-4">
            <pre className="font-sans text-xs whitespace-pre-wrap text-sand-700">
              {document.extractedText.slice(0, PREVIEW_CHARS)}
              {document.extractedText.length > PREVIEW_CHARS ? "\n\n…" : ""}
            </pre>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
