"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import type { LoadedConversation, ThreadSummary } from "@/lib/chat/history";
import type { AnswerProgress } from "@/lib/rag/answer";
import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { Modal, ModalBody } from "@/components/modal";
import { Button, EmptyState, ErrorState, LinkButton } from "@/components/ui";
import { assistantTurnFrom, streamAnswer } from "./ask-stream";
import { Composer } from "./composer";
import { DocumentChooser } from "./document-chooser";
import { ThreadRail } from "./thread-rail";
import { Transcript } from "./transcript";
import { ProposalCard, proposalPatch } from "./proposal-card";
import {
  toTurns,
  type ChatFocusState,
  type FocusOptions,
  type ProjectOption,
  type Turn,
} from "./types";

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

export function ChatWorkspace({
  readyDocumentCount,
  projects,
  threads,
  conversation,
  initialProjectId,
  focus,
  focusOptions,
  nowIso,
}: {
  readyDocumentCount: number;
  projects: ProjectOption[];
  threads: ThreadSummary[];
  conversation: LoadedConversation | null;
  initialProjectId: string;
  /** Like the project: changing it is a navigation to a new thread. */
  focus: ChatFocusState;
  focusOptions: FocusOptions;
  nowIso: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();

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
  const [choosingDocuments, setChoosingDocuments] = useState(false);

  // Sent with every question; the server holds an existing thread to what it
  // was started with, so this only decides the focus of a new one.
  const focusRequest =
    focus.kind === "task" && focus.taskId
      ? { taskId: focus.taskId }
      : focus.kind === "documents"
        ? { documentIds: focus.documents.map((document) => document.id) }
        : {};

  // Guards a stale stream from writing over a newer one.
  const requestId = useRef(0);

  const anyEvidenceAvailable =
    readyDocumentCount > 0 ||
    projects.some(
      (project) => project.readyDocumentCount > 0 || project.liveRecordCount > 0,
    );

  /** Evidence sets are never mixed within one thread (invariant 13), so a
   *  new scope or focus is a new thread — confirmed first when one is open. */
  async function startThread(target: {
    projectId: string;
    taskId?: string;
    documentIds?: string[];
  }) {
    if (turns.length > 0) {
      const confirmed = await confirm({
        title: "Start a new thread?",
        body: "Answers from different evidence sets are never mixed, so changing what you are asking about begins a fresh conversation.",
        confirmLabel: "Start new thread",
      });
      if (!confirmed) return;
    }

    const params = new URLSearchParams();
    if (target.projectId) params.set("project", target.projectId);
    if (target.taskId) params.set("task", target.taskId);
    if (target.documentIds?.length) params.set("docs", target.documentIds.join(","));
    const query = params.toString();
    router.push(query ? `/chat?${query}` : "/chat");
  }

  async function changeProject(nextProjectId: string) {
    if (nextProjectId === projectId) return;
    await startThread({ projectId: nextProjectId });
  }

  async function changeFocus(value: string) {
    if (value === "choose-documents") {
      setChoosingDocuments(true);
      return;
    }
    if (value.startsWith("task:")) {
      await startThread({ projectId, taskId: value.slice("task:".length) });
    } else if (value.startsWith("doc:")) {
      await startThread({ projectId, documentIds: [value.slice("doc:".length)] });
    } else {
      await startThread({ projectId });
    }
  }

  async function applyProposal(proposal: Parameters<typeof proposalPatch>[0]) {
    if (focus.kind !== "task" || !focus.taskId) return false;
    try {
      const response = await fetch(`/api/tasks/${focus.taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(proposalPatch(proposal)),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(data.error ?? "Could not apply that change.");
        return false;
      }
      toast.success("Applied to the task");
      return true;
    } catch {
      toast.error("Could not reach the server.");
      return false;
    }
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

    const outcome = await streamAnswer(
      {
        question: trimmed,
        conversationId,
        projectId: projectId || null,
        ...focusRequest,
      },
      {
        isCurrent: () => generation === requestId.current,
        onAccepted: (payload) => {
          setConversationId(payload.conversationId);
          // Pin the new thread to its own URL so a reload returns to it.
          // `replaceState` rather than a router navigation: Next syncs it with
          // usePathname without re-fetching the page, so the turn that is
          // mid-flight right now is not thrown away and replaced by a server
          // render. This is why /chat and /chat/[id] are one segment.
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
        },
        onProgress: (progress) => setPhases((previous) => [...previous, progress]),
        onResult: (payload) =>
          setTurns((previous) => [...previous, assistantTurnFrom(payload)]),
        onError: fail,
      },
    );

    if (outcome === "superseded") return;
    setPending(false);
    setPhases([]);
    // A brand-new thread needs to appear in the rail; refresh re-runs the
    // page's server components without discarding this component's state.
    if (outcome === "answered" && isNewThread) router.refresh();
  }

  async function renameThread(thread: ThreadSummary, title: string) {
    try {
      const response = await fetch(`/api/chat/conversations/${thread.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(data.error ?? "Could not rename that thread.");
        return;
      }
      router.refresh();
    } catch {
      toast.error("Could not reach the server.");
    }
  }

  async function deleteThread(thread: ThreadSummary) {
    const confirmed = await confirm({
      title: `Delete “${thread.title}”?`,
      body: "Its questions, answers, and any feedback you gave on them are removed. This cannot be undone.",
      confirmLabel: "Delete thread",
      tone: "danger",
    });
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/chat/conversations/${thread.id}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(data.error ?? "Could not delete that thread.");
        return;
      }
      toast.success("Thread deleted");
      setThreadsOpen(false);
      // Leaving a deleted thread's URL, rather than refreshing it into a 404.
      if (thread.id === conversationId) router.push("/chat");
      else router.refresh();
    } catch {
      toast.error("Could not reach the server.");
    }
  }

  // Without evidence there is nothing to ask against, but earlier threads are
  // still worth reaching — so the rail and heading stay and only the composer
  // gives way to the empty state.
  const noEvidence = !anyEvidenceAvailable && turns.length === 0;

  return (
    <div className="flex gap-6">
      <ThreadRail
        threads={threads}
        activeId={conversationId ?? null}
        nowIso={nowIso}
        onRename={renameThread}
        onDelete={deleteThread}
        className="sticky top-6 hidden max-h-[calc(100dvh-3rem)] w-60 shrink-0 overflow-y-auto lg:block"
      />

      <div className="min-w-0 flex-1">
        <div className="mx-auto flex w-full max-w-3xl flex-col">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight">
                {conversation?.conversation.title ?? "Ask"}
              </h1>
              {focus.kind === "task" ? (
                <p className="mt-1 text-sm text-slate-600">
                  About the task{" "}
                  {focus.taskId && projectId ? (
                    <a
                      href={`/projects/${projectId}/tasks?task=${focus.taskId}`}
                      className="font-medium text-slate-900 underline"
                    >
                      {focus.taskTitle}
                    </a>
                  ) : (
                    <span className="font-medium">(deleted)</span>
                  )}
                  : its record, connected records, and linked documents. Answers
                  can propose edits for you to apply.
                </p>
              ) : focus.kind === "documents" ? (
                <p className="mt-1 text-sm text-slate-600">
                  Only from{" "}
                  <span className="font-medium text-slate-900">
                    {focus.documents.length === 1
                      ? focus.documents[0].filename
                      : `${focus.documents.length} chosen documents`}
                  </span>
                  .
                </p>
              ) : (
                <p className="mt-1 text-sm text-slate-600">
                  Grounded answers from your documents, and from a project&rsquo;s
                  approved records when you pick one.
                </p>
              )}
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

          {noEvidence ? (
            <EmptyState
              title="No supporting project evidence yet"
              description="Index a document or add approved project records before asking questions."
              action={
                <LinkButton href={projectId ? `/projects/${projectId}` : "/projects"}>
                  {projectId ? "Go to project" : "Go to projects"}
                </LinkButton>
              }
            />
          ) : turns.length === 0 ? (
            <div className="mb-4">
              <EmptyState
                title="Ask a question to start"
                description="Every claim in an answer is cited back to the document passage or live project record it came from. If nothing supports an answer, you get a refusal rather than a guess."
              />
            </div>
          ) : (
            <Transcript
              turns={turns}
              pending={pending}
              phases={phases}
              projectScoped={Boolean(projectId)}
              onRetry={ask}
              renderProposals={
                focus.kind === "task" && focus.taskId
                  ? (turn) => (
                      <div className="space-y-2">
                        {turn.proposals.map((proposal) => (
                          <ProposalCard
                            key={proposal.field}
                            proposal={proposal}
                            current={focus.current}
                            onApply={applyProposal}
                          />
                        ))}
                      </div>
                    )
                  : undefined
              }
            />
          )}

          {error ? (
            <div className="mb-3">
              <ErrorState message={error} />
            </div>
          ) : null}

          {noEvidence ? null : (
          <Composer
            value={question}
            projectId={projectId}
            projects={projects}
            readyDocumentCount={readyDocumentCount}
            focus={focus}
            focusOptions={focusOptions}
            pending={pending}
            onChange={setQuestion}
            onProjectChange={changeProject}
            onFocusChange={changeFocus}
            onSubmit={() => ask(question)}
            // The negative margin lets the sticky bar cover content edge to
            // edge instead of letting text slide through the gutter beside it.
            className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white px-4 pt-3 pb-4 sm:-mx-6 sm:px-6"
          />
          )}
        </div>
      </div>

      {choosingDocuments ? (
        <DocumentChooser
          documents={focusOptions.documents}
          initial={focus.kind === "documents" ? focus.documents.map((d) => d.id) : []}
          onCancel={() => setChoosingDocuments(false)}
          onChoose={(documentIds) => {
            setChoosingDocuments(false);
            void startThread({ projectId, documentIds });
          }}
        />
      ) : null}

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
              onRename={renameThread}
              onDelete={deleteThread}
            />
          </ModalBody>
        </Modal>
      ) : null}
    </div>
  );
}
