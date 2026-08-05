import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { answerQuestion } from "@/lib/rag/answer";
import { askQuestionSchema } from "@/lib/schemas";

/** Upper bound on turns loaded for context; the RAG layer trims further. */
const MAX_HISTORY_MESSAGES = 12;

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function POST(request: Request) {
  try {
    const { workspaceId, user } = await requireWorkspace();

    const body = await request.json().catch(() => null);
    const parsed = askQuestionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const { question } = parsed.data;
    const projectId = parsed.data.projectId ?? null;
    const groundingScope = projectId ? "project_combined" : "documents";

    if (projectId) {
      const project = await prisma.project.findFirst({
        where: { id: projectId, workspaceId },
        select: { id: true },
      });
      if (!project) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
    }

    // Resolve the conversation, scoped to this workspace AND this user.
    let conversationId = parsed.data.conversationId;
    if (conversationId) {
      const existing = await prisma.chatConversation.findFirst({
        where: {
          id: conversationId,
          workspaceId,
          userId: user.id,
          projectId,
          groundingScope,
        },
        select: { id: true },
      });
      if (!existing) {
        return NextResponse.json(
          { error: "Conversation not found" },
          { status: 404 },
        );
      }
    } else {
      const created = await prisma.chatConversation.create({
        data: {
          workspaceId,
          projectId,
          userId: user.id,
          title: question.slice(0, 80),
          groundingScope,
        },
        select: { id: true },
      });
      conversationId = created.id;
    }

    // Load prior turns before writing the new one, so the history passed to the
    // model excludes the question being asked right now.
    const priorTurns = await prisma.chatMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: MAX_HISTORY_MESSAGES,
      select: { role: true, content: true },
    });

    await prisma.chatMessage.create({
      data: { conversationId, role: "user", content: question },
    });

    const result = await answerQuestion(workspaceId, question, {
      projectId,
      groundingScope,
      history: priorTurns.toReversed().map((turn) => ({
        role: turn.role,
        content: turn.content,
      })),
    });

    // Persist enough to audit the answer later: chunks used, model, latency.
    const assistantMessage = await prisma.chatMessage.create({
      data: {
        conversationId,
        role: "assistant",
        content: result.answer,
        citations: jsonValue(result.citations),
        confidence: result.confidence,
        latencyMs: result.latencyMs,
        modelName: result.modelName,
        retrievedChunkIds: jsonValue(result.retrievedChunkIds),
        groundingSourceIds: jsonValue(result.groundingSourceIds),
      },
      select: { id: true },
    });

    if (result.droppedSourceIds.length > 0) {
      console.warn(
        `[chat] model cited ${result.droppedSourceIds.length} unsupplied source(s):`,
        result.droppedSourceIds,
      );
    }

    return NextResponse.json({
      messageId: assistantMessage.id,
      conversationId,
      answer: result.answer,
      confidence: result.confidence,
      citations: result.citations,
      refused: result.refused,
      latencyMs: result.latencyMs,
      modelName: result.modelName,
      groundingScope,
    });
  } catch (error) {
    return handleRouteError(error, "POST /api/chat");
  }
}
