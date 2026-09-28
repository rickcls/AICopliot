import "server-only";
import { prisma } from "@/lib/db";
import { buildVerifiedExcerpt } from "@/lib/grounding/document-citations";

export interface TaskRelationInput {
  documentIds?: string[];
  citations?: Array<{ chunkId: string; quote: string }>;
  requirementIds?: string[];
}

export interface ResolvedTaskRelations {
  documentIds?: string[];
  citations: Array<{ documentChunkId: string; excerpt: string }>;
  requirementIds: string[];
}

export type TaskRelationResult =
  | { ok: true; value: ResolvedTaskRelations }
  | { ok: false; error: string };

/**
 * Resolves the ids a task form sends against the task's own project.
 *
 * Every id comes from the client, so none is trusted: a document or
 * requirement from another project — or another workspace — must not resolve.
 * Documents and requirements are refused outright, because a link the user
 * asked for silently not appearing is worse than an error. Citations are
 * provenance rather than a request, so an unknown chunk is dropped, and the
 * excerpt is rebuilt from the stored chunk so it is always the document's own
 * words.
 */
export async function resolveTaskRelations(
  workspaceId: string,
  projectId: string,
  input: TaskRelationInput,
): Promise<TaskRelationResult> {
  const documentIds = input.documentIds;
  const requirementIds = input.requirementIds ?? [];
  const citations = input.citations ?? [];

  const [documents, requirements, chunks] = await Promise.all([
    documentIds && documentIds.length > 0
      ? prisma.document.findMany({
          where: { id: { in: documentIds }, workspaceId, projectId },
          select: { id: true },
        })
      : [],
    requirementIds.length > 0
      ? prisma.requirement.findMany({
          where: {
            id: { in: requirementIds },
            workspaceId,
            projectId,
            status: { not: "rejected" },
          },
          select: { id: true },
        })
      : [],
    citations.length > 0
      ? prisma.documentChunk.findMany({
          where: {
            id: { in: citations.map((citation) => citation.chunkId) },
            workspaceId,
            document: { workspaceId, projectId },
          },
          select: { id: true, content: true },
        })
      : [],
  ]);

  if (documentIds && documents.length !== documentIds.length) {
    return { ok: false, error: "Every linked document must belong to this project" };
  }
  if (requirements.length !== requirementIds.length) {
    return {
      ok: false,
      error: "Every linked requirement must belong to this project and not be rejected",
    };
  }

  const contentById = new Map(chunks.map((chunk) => [chunk.id, chunk.content]));
  const seen = new Set<string>();
  const resolvedCitations: ResolvedTaskRelations["citations"] = [];
  for (const citation of citations) {
    const content = contentById.get(citation.chunkId);
    if (content === undefined || seen.has(citation.chunkId)) continue;
    seen.add(citation.chunkId);
    resolvedCitations.push({
      documentChunkId: citation.chunkId,
      excerpt: buildVerifiedExcerpt(citation.quote, content),
    });
  }

  return {
    ok: true,
    value: {
      documentIds,
      citations: resolvedCitations,
      requirementIds,
    },
  };
}
