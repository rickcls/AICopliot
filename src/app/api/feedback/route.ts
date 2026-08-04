import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { feedbackSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  try {
    const { workspaceId, user } = await requireWorkspace();

    const body = await request.json().catch(() => null);
    const parsed = feedbackSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const { chatMessageId, rating, comment } = parsed.data;

    // Reach the message only through its conversation's workspace, so feedback
    // cannot be attached to another workspace's message.
    const message = await prisma.chatMessage.findFirst({
      where: {
        id: chatMessageId,
        role: "assistant",
        conversation: { workspaceId, userId: user.id },
      },
      select: { id: true },
    });

    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    // One vote per user per message; voting again updates it.
    const feedback = await prisma.answerFeedback.upsert({
      where: { chatMessageId_userId: { chatMessageId, userId: user.id } },
      create: { chatMessageId, userId: user.id, rating, comment },
      update: { rating, comment },
      select: { id: true, rating: true },
    });

    return NextResponse.json({ ok: true, feedback });
  } catch (error) {
    return handleRouteError(error, "POST /api/feedback");
  }
}
