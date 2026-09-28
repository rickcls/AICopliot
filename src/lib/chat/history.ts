import "server-only";
import { prisma } from "@/lib/db";
import type { Citation, Confidence } from "@/lib/schemas";
import { parseStoredCitations } from "./stored-citations";

/**
 * Reading threads back.
 *
 * Every message has always been persisted; nothing ever read it. These are the
 * loaders the chat page calls so the transcript arrives as props — server
 * components fetch and pass down, rather than the client fetching on mount.
 *
 * Both are scoped by workspace AND user, matching the write path: a
 * conversation belongs to the person who had it, not to the workspace at large.
 */

export interface ThreadSummary {
  id: string;
  title: string;
  projectId: string | null;
  projectName: string | null;
  groundingScope: "documents" | "project_combined";
  messageCount: number;
  createdAt: string;
  lastMessageAt: string;
}

export interface ConversationTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  /** A stored citation blob existed but no longer validates. */
  citationsUnavailable: boolean;
  confidence: Confidence | null;
  refused: boolean;
  latencyMs: number | null;
  createdAt: string;
  myRating: "up" | "down" | null;
}

export interface LoadedConversation {
  conversation: ThreadSummary;
  turns: ConversationTurn[];
}

export async function listConversations(
  workspaceId: string,
  userId: string,
  take = 30,
): Promise<ThreadSummary[]> {
  const rows = await prisma.chatConversation.findMany({
    where: { workspaceId, userId },
    orderBy: { lastMessageAt: "desc" },
    take,
    select: {
      id: true,
      title: true,
      projectId: true,
      groundingScope: true,
      createdAt: true,
      lastMessageAt: true,
      project: { select: { name: true } },
      _count: { select: { messages: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    projectId: row.projectId,
    projectName: row.project?.name ?? null,
    groundingScope: row.groundingScope,
    messageCount: row._count.messages,
    createdAt: row.createdAt.toISOString(),
    lastMessageAt: row.lastMessageAt.toISOString(),
  }));
}

export async function loadConversation(
  workspaceId: string,
  userId: string,
  conversationId: string,
): Promise<LoadedConversation | null> {
  const row = await prisma.chatConversation.findFirst({
    where: { id: conversationId, workspaceId, userId },
    select: {
      id: true,
      title: true,
      projectId: true,
      groundingScope: true,
      createdAt: true,
      lastMessageAt: true,
      project: { select: { name: true } },
      _count: { select: { messages: true } },
      messages: {
        // Oldest first: a transcript, not a result list.
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          content: true,
          citations: true,
          confidence: true,
          refused: true,
          latencyMs: true,
          createdAt: true,
          // Unique on (chatMessageId, userId), so at most one row.
          feedback: { where: { userId }, select: { rating: true } },
        },
      },
    },
  });

  if (!row) return null;

  return {
    conversation: {
      id: row.id,
      title: row.title,
      projectId: row.projectId,
      projectName: row.project?.name ?? null,
      groundingScope: row.groundingScope,
      messageCount: row._count.messages,
      createdAt: row.createdAt.toISOString(),
      lastMessageAt: row.lastMessageAt.toISOString(),
    },
    turns: row.messages.map((message) => {
      const stored = parseStoredCitations(message.citations);
      return {
        id: message.id,
        role: message.role,
        content: message.content,
        citations: stored.citations,
        // A refusal never had citations, so it is not "missing" them.
        citationsUnavailable: stored.unavailable && !message.refused,
        confidence: message.confidence,
        refused: message.refused,
        latencyMs: message.latencyMs,
        createdAt: message.createdAt.toISOString(),
        myRating: message.feedback[0]?.rating ?? null,
      };
    }),
  };
}

/**
 * Renames one of the caller's threads. `updateMany` with the full
 * (id, workspace, user) triple rather than a lookup-then-update, so a thread id
 * belonging to anyone else simply matches nothing — there is no window between
 * the ownership check and the write. Returns whether a row was changed.
 */
export async function renameConversation(
  workspaceId: string,
  userId: string,
  conversationId: string,
  title: string,
): Promise<boolean> {
  const { count } = await prisma.chatConversation.updateMany({
    where: { id: conversationId, workspaceId, userId },
    data: { title },
  });
  return count > 0;
}

/**
 * Deletes one of the caller's threads; its messages and their feedback cascade.
 * Scoped by the same triple, for the same reason.
 */
export async function deleteConversation(
  workspaceId: string,
  userId: string,
  conversationId: string,
): Promise<boolean> {
  const { count } = await prisma.chatConversation.deleteMany({
    where: { id: conversationId, workspaceId, userId },
  });
  return count > 0;
}
