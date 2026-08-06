"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import type { LoadedConversation, ThreadSummary } from "@/lib/chat/history";
import { parseSseChunk } from "@/lib/chat/sse";
import type { AnswerProgress } from "@/lib/rag/answer";
import { citationSchema } from "@/lib/schemas";
import { useConfirm } from "@/components/confirm-dialog";
import { Modal, ModalBody } from "@/components/modal";
import { Button, EmptyState, ErrorState } from "@/components/ui";
import { Composer } from "./composer";
import { ThreadRail } from "./thread-rail";
import { Transcript } from "./transcript";
import { toTurns, type ProjectOption, type Turn } from "./types";

/**
 * The chat surface: thread rail, transcript, composer, and the stream that
 * feeds them.
 *
 * The layout is document flow plus `sticky`, not a fixed-height flex column. A
 * `100dvh` scroll container would have to hard-code the app shell's padding, and
 * it is what breaks under the iOS virtual keyboard; sticky needs no measurement
 * and behaves at every breakpoint. The transcript keeps its `max-w-3xl` measure
 * *inside* the wide row, so prose stays readable while the rail gets real space.
 */

interface StreamResult {
  messageId: string;
  conversationId: string;
  answer: string;
  confidence: "high" | "medium" | "low";
  citations: unknown;
  refused: boolean;
  latencyMs: number;
  createdAt: string;
}

export function ChatWorkspace({
  readyDocumentCount,
  projects,
  threads,
  conversation,
  initialProjectId,
  nowIso,
}: {
  readyDocumentCount: number;
  projects: ProjectOption[];
  threads: ThreadSummary[];
  conversation: LoadedConversation | null;
  initialProjectId: string;
  nowIso: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();

  // The page keys this component on the conversation id, so state starts from
  // the right thread on every navigation without an effect copying props.
  const [turns, setTurns] = useState<Turn[]>(() =>
    conversation ? toTurns(conversation.turns) : [],
  );
  const [conversationId, setConversationId] = useState<string | undefined>(
    conversation?.conversation.id,
  );
  // Not state: changing scope starts a new thread, which is a navigation, and
  // the page remounts this component with the new value.
  const projectId = initialProjectId;
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [phases, setPhases] = useState<AnswerProgress[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [threadsOpen, setThreadsOpen] = useState(false);

  // Guards a stale stream from writing over a newer one.
  const requestId = useRef(0);

  const anyEvidenceAvailable =
    readyDocumentCount > 0 ||
    projects.some(
      (project) => project.readyDocumentCount > 0 || project.liveRecordCount > 0,
    );

  async function changeProject(nextProjectId: string) {
    if (nextProjectId === projectId) return;

    // Evidence sets are never mixed within one thread (invariant 13). That used
    // to silently wipe the answer list; now it says so first.
    if (turns.length > 0) {
      const confirmed = await confirm({
        title: "Start a new thread?",
        body: "Answers from different evidence sets are never mixed, so changing what you are asking about begins a fresh conversation.",
        confirmLabel: "Start new thread",
      });
      if (!confirmed) return;
    }

    router.push(nextProjectId ? `/chat?project=${nextProjectId}` : "/chat");
  }

  async function ask(content: string) {
    const trimmed = content.trim();
    if (trimmed.length < 3 || pending) return;

    const generation = (requestId.current += 1);
    const localId = `pending-${generation}`;
    const isNewThread = !conversationId;

    setPending(true);
    setPhases([]);
    setError(null);
    setQuestion("");
    setTurns((previous) => [
      ...previous,
      {
        kind: "user",
        id: localId,
        content: trimmed,
        status: "sending",
        createdAt: new Date().toISOString(),
      },
    ]);

    const fail = (message: string) => {
      setError(message);
      setTurns((previous) =>
        previous.map((turn) =>
          turn.id === localId && turn.kind === "user"
            ? { ...turn, status: "failed" }
            : turn,
        ),
      );
    };

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          conversationId,
          projectId: projectId || null,
        }),
      });

      // Guards return JSON with a real status; only a 200 carries a stream.
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        fail(data.error ?? "Could not get an answer.");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let settled = false;

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (generation !== requestId.current) return; // superseded

        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = parseSseChunk(buffer);
        buffer = rest;

        for (const frame of events) {
          const payload = JSON.parse(frame.data);

          if (frame.event === "accepted") {
            setConversationId(payload.conversationId);
            // Pin the new thread to its own URL so a reload returns to it.
            // `replaceState` rather than a router navigation: Next syncs it
            // with usePathname without re-fetching the page, so the turn that
            // is mid-flight right now is not thrown away and replaced by a
            // server render. This is why /chat and /chat/[id] are one segment.
            if (isNewThread) {
              window.history.replaceState(null, "", `/chat/${payload.conversationId}`);
            }
            setTurns((previous) =>
              previous.map((turn) =>
                turn.id === localId && turn.kind === "user"
                  ? { ...turn, id: payload.questionMessageId, status: "sent" }
                  : turn,
              ),
            );
          } else if (frame.event === "progress") {
            setPhases((previous) => [...previous, payload as AnswerProgress]);
          } else if (frame.event === "result") {
            settled = true;
            appendAnswer(payload as StreamResult);
          } else if (frame.event === "error") {
            settled = true;
            fail(payload.error ?? "Could not get an answer.");
          }
        }
      }

      if (!settled) fail("The answer stream ended unexpectedly.");
      // A brand-new thread needs to appear in the rail; refresh re-runs the
      // page's server components without discarding this component's state.
      else if (isNewThread) router.refresh();
    } catch {
      if (generation === requestId.current) {
        fail("Could not reach the server. Please try again.");
      }
    } finally {
      if (generation === requestId.current) {
        setPending(false);
        setPhases([]);
      }
    }
  }

  function appendAnswer(result: StreamResult) {
    // Citations cross the wire as JSON, so they are re-validated here for the
    // same reason a stored blob is: the renderer must never be handed a shape
    // it cannot narrow.
    const parsed = citationSchema.array().safeParse(result.citations);

    setTurns((previous) => [
      ...previous,
      {
        kind: "assistant",
        id: result.messageId,
        content: result.answer,
        citations: parsed.success ? parsed.data : [],
        citationsUnavailable: !parsed.success && !result.refused,
        confidence: result.confidence,
        refused: result.refused,
        latencyMs: result.latencyMs,
        createdAt: result.createdAt,
        myRating: null,
      },
    ]);
  }

  if (!anyEvidenceAvailable && turns.length === 0) {
    return (
      <EmptyState
        title="No supporting project evidence yet"
        description="Index a document or add approved project records before asking questions."
        action={
          <Button onClick={() => router.push(projectId ? `/projects/${projectId}` : "/projects")}>
            {projectId ? "Go to project" : "Go to projects"}
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex gap-6">
      <ThreadRail
        threads={threads}
        activeId={conversationId ?? null}
        nowIso={nowIso}
        className="sticky top-6 hidden max-h-[calc(100dvh-3rem)] w-60 shrink-0 overflow-y-auto lg:block"
      />

      <div className="min-w-0 flex-1">
        <div className="mx-auto flex w-full max-w-3xl flex-col">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight">
                {conversation?.conversation.title ?? "Ask"}
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                Grounded answers from your documents, and from a project&rsquo;s
                approved records when you pick one.
              </p>
            </div>
            {/* Below lg the rail has no room beside the 56px icon sidebar, so
                the same component opens in a dialog instead. */}
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0 lg:hidden"
              onClick={() => setThreadsOpen(true)}
            >
              <MessagesSquare className="size-4 text-slate-400" aria-hidden />
              Threads ({threads.length})
            </Button>
          </div>

          {turns.length === 0 ? (
            <div className="mb-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-10 text-center">
              <h2 className="text-sm font-semibold text-slate-900">
                Ask a question to start
              </h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                Every claim in an answer is cited back to the document passage or
                live project record it came from. If nothing supports an answer,
                you get a refusal rather than a guess.
              </p>
            </div>
          ) : (
            <Transcript
              turns={turns}
              pending={pending}
              phases={phases}
              projectScoped={Boolean(projectId)}
              onRetry={ask}
            />
          )}

          {error ? (
            <div className="mb-3">
              <ErrorState message={error} />
            </div>
          ) : null}

          <Composer
            value={question}
            projectId={projectId}
            projects={projects}
            readyDocumentCount={readyDocumentCount}
            pending={pending}
            onChange={setQuestion}
            onProjectChange={changeProject}
            onSubmit={() => ask(question)}
            // The negative margin lets the sticky bar cover content edge to
            // edge instead of letting text slide through the gutter beside it.
            className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white px-4 pt-3 pb-4 sm:-mx-6 sm:px-6"
          />
        </div>
      </div>

      {threadsOpen ? (
        <Modal
          title="Conversations"
          onClose={() => setThreadsOpen(false)}
          className="max-w-sm"
        >
          <ModalBody>
            <ThreadRail
              threads={threads}
              activeId={conversationId ?? null}
              nowIso={nowIso}
              onNavigate={() => setThreadsOpen(false)}
            />
          </ModalBody>
        </Modal>
      ) : null}
    </div>
  );
}
