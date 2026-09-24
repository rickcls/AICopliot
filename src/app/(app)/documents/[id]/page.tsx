import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteDocumentButton } from "@/components/delete-document-button";
import { RetryIngestionButton } from "@/components/retry-ingestion-button";
import { Badge, Card, LinkButton, SectionHeader } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { formatBytes, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_TONE = {
  uploaded: "info",
  processing: "warning",
  ready: "success",
  failed: "danger",
} as const;

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { workspaceId } = await requireWorkspace();
  const { id } = await params;

  // Scoped by workspaceId: an ID from another workspace 404s rather than leaking.
  const document = await prisma.document.findFirst({
    where: { id, workspaceId },
    include: { project: { select: { name: true } } },
  });

  if (!document) notFound();

  return (
    // Extracted document text is prose; cap the width so lines stay readable.
    <div className="mx-auto w-full max-w-4xl">
      <Link
        href="/documents"
        className="text-sm text-slate-500 hover:text-slate-900"
      >
        ← Documents
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight break-words">
            {document.originalFilename}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {formatBytes(document.sizeBytes)} · uploaded{" "}
            {formatDate(document.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={STATUS_TONE[document.status]}>{document.status}</Badge>
          {document.status === "failed" ? (
            <RetryIngestionButton id={document.id} />
          ) : null}
          <DeleteDocumentButton
            id={document.id}
            filename={document.originalFilename}
          />
        </div>
      </div>

      {document.status === "failed" && document.errorMessage ? (
        <div
          role="alert"
          className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3"
        >
          <p className="text-sm font-medium text-red-800">Processing failed</p>
          <p className="mt-1 text-sm text-red-700">{document.errorMessage}</p>
        </div>
      ) : null}

      <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Project", value: document.project?.name ?? "Unassigned" },
          { label: "Chunks indexed", value: String(document.chunkCount) },
          { label: "Content type", value: document.mimeType || "unknown" },
          { label: "Last updated", value: formatDate(document.updatedAt) },
        ].map((item) => (
          <div key={item.label}>
            <dt className="text-xs text-slate-500">{item.label}</dt>
            <dd className="mt-0.5 truncate text-sm font-medium" title={item.value}>
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      {document.chunkCount > 0 ? (
        <section className="mt-8">
          <LinkButton
            href={`/documents/${document.id}/chunks`}
            variant="secondary"
          >
            Review indexed chunks ({document.chunkCount})
          </LinkButton>
        </section>
      ) : null}

      {document.extractedText ? (
        <section className="mt-8">
          <SectionHeader
            title="Extracted text preview"
            description={
              document.extractedText.length > 5000
                ? "First 5,000 characters. The full text is in the indexed chunks."
                : undefined
            }
          />
          <Card className="mt-3 max-h-96 overflow-auto p-4">
            <pre className="font-sans text-xs whitespace-pre-wrap text-slate-700">
              {document.extractedText.slice(0, 5000)}
              {document.extractedText.length > 5000 ? "\n\n…" : ""}
            </pre>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
