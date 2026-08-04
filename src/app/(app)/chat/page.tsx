import { ChatPanel } from "@/components/chat-panel";
import { prisma } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const { workspaceId } = await requireWorkspace();

  const readyCount = await prisma.document.count({
    where: { workspaceId, status: "ready" },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Ask</h1>
        <p className="mt-1 text-sm text-slate-600">
          Answers come only from your uploaded documents. If the documents
          don&apos;t cover it, the assistant will say so.
        </p>
      </div>
      <ChatPanel readyDocumentCount={readyCount} />
    </div>
  );
}
