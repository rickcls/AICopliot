import "server-only";
import type { WorkspaceAccess } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import {
  buildDocumentLabelUserMessage,
  DOCUMENT_LABEL_SYSTEM_PROMPT,
  LABEL_OVERVIEW_QUERY,
  MAX_LABEL_CHUNKS,
  modelDocumentLabelSchema,
  validateDocumentLabel,
} from "@/lib/documents/label";
import { buildLabelledContext, selectDocumentContext } from "@/lib/generation/context";
import { extractJsonObject } from "@/lib/generation/prompt";
import { detectReplyLanguage } from "@/lib/language";
import { visibleProjectWhere } from "@/lib/pm/visibility";
import {
  getChatProvider,
  getEmbeddingProvider,
  type ChatProvider,
  type EmbeddingProvider,
} from "@/lib/providers";

export class LabelError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 422,
  ) {
    super(message);
    this.name = "LabelError";
  }
}

function parseLabel(raw: string) {
  try {
    const parsed = modelDocumentLabelSchema.safeParse(JSON.parse(extractJsonObject(raw)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Labels one ready document. Runs as its own request after indexing rather
 * than inside it, so the 60-second ingestion budget is spent on indexing.
 *
 * A person's own edits win: once `labelSource` is "manual", a later AI pass
 * refreshes only the summary and the project suggestion and leaves the title,
 * type, and tags alone.
 */
export async function labelDocument(
  access: WorkspaceAccess,
  documentId: string,
  deps: { chat?: ChatProvider; embeddings?: EmbeddingProvider } = {},
) {
  const document = await prisma.document.findFirst({
    where: { id: documentId, workspaceId: access.workspaceId },
    select: {
      id: true,
      status: true,
      originalFilename: true,
      projectId: true,
      labelSource: true,
    },
  });
  if (!document) throw new LabelError("Document not found", 404);
  if (document.status !== "ready") throw new LabelError("The document is not indexed yet", 409);

  const embeddings = deps.embeddings ?? getEmbeddingProvider();
  const chunks = await selectDocumentContext(
    access.workspaceId,
    [document.id],
    embeddings,
    [LABEL_OVERVIEW_QUERY],
    MAX_LABEL_CHUNKS,
  );
  if (chunks.length === 0) throw new LabelError("This document has no readable text", 422);
  const context = buildLabelledContext(chunks);

  const projects = await prisma.project.findMany({
    where: visibleProjectWhere(access.workspaceId, access.userId),
    orderBy: { updatedAt: "desc" },
    take: 60,
    select: { id: true, name: true },
  });
  const projectLabels = new Map(projects.map((project, index) => [`P${index + 1}`, project.id]));
  const language = detectReplyLanguage(context.contextBlock, "zh-Hant");

  const chat = deps.chat ?? getChatProvider();
  const messages = [
    { role: "system" as const, content: DOCUMENT_LABEL_SYSTEM_PROMPT },
    {
      role: "user" as const,
      content: buildDocumentLabelUserMessage({
        filename: document.originalFilename,
        contextBlock: context.contextBlock,
        projects: projects.map((project, index) => ({ label: `P${index + 1}`, name: project.name })),
        language,
      }),
    },
  ];
  const options = { jsonMode: true, temperature: 0, maxTokens: 1500, reasoning: false };

  let raw = await chat.complete(messages, options);
  let model = parseLabel(raw);
  if (!model) {
    raw = await chat.complete(
      [
        ...messages,
        { role: "assistant" as const, content: raw },
        { role: "user" as const, content: "Reply with only the one JSON object described." },
      ],
      options,
    );
    model = parseLabel(raw);
  }
  if (!model) throw new LabelError("The model returned malformed labels twice. Try again.", 422);

  const label = validateDocumentLabel(model, {
    sourceLabels: new Set(context.sourceMap.keys()),
    projects: projectLabels,
    currentProjectId: document.projectId,
    language,
  });
  const keepManual = document.labelSource === "manual";

  return prisma.document.update({
    where: { id: document.id },
    data: {
      ...(keepManual
        ? {}
        : {
            title: label.title,
            docType: label.docType,
            tags: label.tags,
            labelSource: "ai",
          }),
      summary: label.summary,
      suggestedProjectId: label.suggestedProjectId,
      labelledAt: new Date(),
    },
    select: { id: true, title: true, summary: true, docType: true, tags: true, suggestedProjectId: true },
  });
}
