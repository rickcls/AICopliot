import "server-only";
import { prisma } from "@/lib/db";
import { officialRecordWhere } from "@/lib/pm/rules";
import type { AnswerFocus } from "@/lib/rag/answer";

export type ChatFocusKind = "none" | "task" | "documents";

export interface ResolvedScope {
  projectId: string | null;
  groundingScope: "documents" | "project_combined";
  focus: ChatFocusKind;
  taskId: string | null;
  focusDocumentIds: string[];
}

export type ScopeResult =
  | { ok: true; scope: ResolvedScope }
  | { ok: false; status: 400 | 404; error: string };

/**
 * Resolves what a *new* thread is about from ids the client sent, none of
 * which is trusted on its own.
 *
 * - A task decides its own project, and must be an official record: a draft
 *   awaiting review has no operational meaning to answer from. A projectId
 *   that disagrees with the task's is refused rather than silently corrected.
 * - Documents must belong to the workspace, and to the project when one is
 *   chosen. A focus with no documents left is no focus, so it is refused.
 */
export async function resolveNewThreadScope(
  workspaceId: string,
  input: { projectId: string | null; taskId: string | null; documentIds: string[] },
): Promise<ScopeResult> {
  if (input.taskId) {
    const task = await prisma.task.findFirst({
      where: officialRecordWhere({ id: input.taskId, workspaceId }),
      select: { id: true, projectId: true },
    });
    if (!task) return { ok: false, status: 404, error: "Task not found" };
    if (input.projectId && input.projectId !== task.projectId) {
      return { ok: false, status: 400, error: "That task belongs to a different project" };
    }
    return {
      ok: true,
      scope: {
        projectId: task.projectId,
        groundingScope: "project_combined",
        focus: "task",
        taskId: task.id,
        focusDocumentIds: [],
      },
    };
  }

  if (input.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: input.projectId, workspaceId },
      select: { id: true },
    });
    if (!project) return { ok: false, status: 404, error: "Project not found" };
  }

  if (input.documentIds.length > 0) {
    const documents = await prisma.document.findMany({
      where: {
        id: { in: input.documentIds },
        workspaceId,
        ...(input.projectId ? { projectId: input.projectId } : {}),
      },
      select: { id: true },
    });
    if (documents.length !== input.documentIds.length) {
      return {
        ok: false,
        status: 404,
        error: input.projectId
          ? "Every chosen document must belong to this project"
          : "Document not found",
      };
    }
    return {
      ok: true,
      scope: {
        projectId: input.projectId,
        groundingScope: "documents",
        focus: "documents",
        taskId: null,
        focusDocumentIds: input.documentIds,
      },
    };
  }

  return {
    ok: true,
    scope: {
      projectId: input.projectId,
      groundingScope: input.projectId ? "project_combined" : "documents",
      focus: "none",
      taskId: null,
      focusDocumentIds: [],
    },
  };
}

/**
 * The focus handed to the answer pipeline for one turn.
 *
 * A task's linked documents are read fresh every turn rather than frozen on
 * the thread: linking a document is how you give the task chat more to go on,
 * and it should take effect on the next question.
 */
export async function answerFocusFor(
  workspaceId: string,
  scope: Pick<ResolvedScope, "projectId" | "focus" | "taskId" | "focusDocumentIds">,
): Promise<AnswerFocus | undefined> {
  if (scope.focus === "task" && scope.taskId && scope.projectId) {
    const links = await prisma.taskDocument.findMany({
      where: {
        workspaceId,
        taskId: scope.taskId,
        document: { workspaceId, projectId: scope.projectId },
      },
      select: { documentId: true },
    });
    return {
      kind: "task",
      taskId: scope.taskId,
      documentIds: links.map((link) => link.documentId),
    };
  }
  if (scope.focus === "documents" && scope.focusDocumentIds.length > 0) {
    return { kind: "documents", documentIds: scope.focusDocumentIds };
  }
  return undefined;
}
