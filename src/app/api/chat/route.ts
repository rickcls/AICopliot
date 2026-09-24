import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { errorMessageFor, handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { answerQuestion } from "@/lib/rag/answer";
import { askQuestionSchema } from "@/lib/schemas";

/**
 * Answering streams, but the answer text does not.
 *
 * The response is Server-Sent Events carrying pipeline *phases* — rewriting,
 * retrieving, reasoning, validating — and then the finished answer in one
 * `result` frame. Token streaming is deliberately not offered: citation
 * validation can downgrade a complete answer to a refusal after the model has
 * finished, so streamed prose would sometimes have to be retracted from under
 * the reader.
 *
 * Everything that can fail with a status code runs BEFORE the stream opens. An
 * SSE response is always 200, so a 400 or 404 emitted as an event would be
 * invisible to a client checking `response.ok`.
 */

/** Hobby plan ceiling. A large document or a slow model needs Pro’s longer limit. */
export const maxDuration = 60;

/** Upper bound on turns loaded for context; the RAG layer trims further. */
const MAX_HISTORY_MESSAGES = 12;

/** Keeps an idle connection open through proxies during a slow answer. */
const HEARTBEAT_MS = 15_000;

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
    let conversationTitle: string;
    if (conversationId) {
      const existing = await prisma.chatConversation.findFirst({
        where: {
          id: conversationId,
          workspaceId,
          userId: user.id,
          projectId,
          groundingScope,
        },
        select: { id: true, title: true },
      });
      if (!existing) {
        return NextResponse.json(
          { error: "Conversation not found" },
          { status: 404 },
        );
      }
      conversationTitle = existing.title;
    } else {
      const created = await prisma.chatConversation.create({
        data: {
          workspaceId,
          projectId,
          userId: user.id,
          title: question.slice(0, 80),
          groundingScope,
        },
        select: { id: true, title: true },
      });
      conversationId = created.id;
      conversationTitle = created.title;
    }

    // Load prior turns before writing the new one, so the history passed to the
    // model excludes the question being asked right now.
    const priorTurns = await prisma.chatMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: MAX_HISTORY_MESSAGES,
      select: { role: true, content: true },
    });

    const questionMessage = await prisma.chatMessage.create({
      data: { conversationId, role: "user", content: question },
      select: { id: true, createdAt: true },
    });

    // --- Everything below here is reported over the stream, not by status ---
    const resolvedConversationId = conversationId;
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;

        const enqueue = (payload: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(payload));
          } catch {
            closed = true; // the consumer went away
          }
        };
        const send = (event: string, data: unknown) =>
          enqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

        const heartbeat = setInterval(() => enqueue(": ping\n\n"), HEARTBEAT_MS);

        // Deliberately launched rather than awaited, and deliberately not tied
        // to request.signal: if the browser disconnects mid-answer the pipeline
        // must still finish and persist, or reopening the thread would show a
        // question with no reply. `send` becomes a no-op once the socket is gone.
        void (async () => {
          try {
            send("accepted", {
              conversationId: resolvedConversationId,
              title: conversationTitle,
              questionMessageId: questionMessage.id,
              createdAt: questionMessage.createdAt.toISOString(),
            });

            const result = await answerQuestion(workspaceId, question, {
              projectId,
              groundingScope,
              history: priorTurns.toReversed().map((turn) => ({
                role: turn.role,
                content: turn.content,
              })),
              onProgress: (progress) => send("progress", progress),
            });

            // Persist enough to audit the answer later: chunks used, model,
            // latency. The conversation's ordering timestamp moves in the same
            // transaction, so the thread list can never sort by a timestamp
            // belonging to a message that failed to write.
            const [assistantMessage] = await prisma.$transaction([
              prisma.chatMessage.create({
                data: {
                  conversationId: resolvedConversationId,
                  role: "assistant",
                  content: result.answer,
                  citations: jsonValue(result.citations),
                  confidence: result.confidence,
                  refused: result.refused,
                  latencyMs: result.latencyMs,
                  modelName: result.modelName,
                  retrievedChunkIds: jsonValue(result.retrievedChunkIds),
                  groundingSourceIds: jsonValue(result.groundingSourceIds),
                },
                select: { id: true, createdAt: true },
              }),
              prisma.chatConversation.update({
                where: { id: resolvedConversationId },
                data: { lastMessageAt: new Date() },
              }),
            ]);

            if (result.droppedSourceIds.length > 0) {
              console.warn(
                `[chat] model cited ${result.droppedSourceIds.length} unsupplied source(s):`,
                result.droppedSourceIds,
              );
            }

            send("result", {
              messageId: assistantMessage.id,
              conversationId: resolvedConversationId,
              answer: result.answer,
              confidence: result.confidence,
              citations: result.citations,
              refused: result.refused,
              latencyMs: result.latencyMs,
              modelName: result.modelName,
              groundingScope,
              createdAt: assistantMessage.createdAt.toISOString(),
            });
          } catch (error) {
            console.error("[POST /api/chat] stream", error);
            send("error", { error: errorMessageFor(error) });
          } finally {
            clearInterval(heartbeat);
            if (!closed) {
              closed = true;
              try {
                controller.close();
              } catch {
                // Already closed by the consumer disconnecting.
              }
            }
          }
        })();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return handleRouteError(error, "POST /api/chat");
  }
}
