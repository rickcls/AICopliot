"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import type { Citation } from "@/lib/schemas";

interface Answer {
  messageId: string;
  question: string;
  answer: string;
  confidence: "high" | "medium" | "low";
  citations: Citation[];
  refused: boolean;
  latencyMs: number;
}

const CONFIDENCE_TONE = {
  high: "success",
  medium: "warning",
  low: "neutral",
} as const;

function CitationCard({ citation }: { citation: Citation }) {
  const location = [
    citation.pageNumber !== null ? `page ${citation.pageNumber}` : null,
    citation.sectionTitle,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link
          href={`/documents/${citation.documentId}`}
          className="text-xs font-medium text-slate-900 hover:underline"
        >
          {citation.filename}
        </Link>
        {location ? (
          <span className="text-xs text-slate-500">{location}</span>
        ) : null}
        <span className="ml-auto text-xs text-slate-400">
          {citation.matchType === "lexical"
            ? "exact text match"
            : citation.matchType === "hybrid"
              ? `hybrid · ${(citation.score * 100).toFixed(0)}% semantic`
              : `${(citation.score * 100).toFixed(0)}% semantic match`}
        </span>
      </div>
      <blockquote className="mt-2 border-l-2 border-slate-300 pl-3 text-xs text-pretty text-slate-600 italic">
        {citation.excerpt}
      </blockquote>
    </div>
  );
}

function FeedbackButtons({ messageId }: { messageId: string }) {
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [failed, setFailed] = useState(false);

  async function send(value: "up" | "down") {
    const previous = rating;
    setRating(value);
    setFailed(false);

    const response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatMessageId: messageId, rating: value }),
    }).catch(() => null);

    if (!response?.ok) {
      setRating(previous);
      setFailed(true);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500">Was this helpful?</span>
      <Button
        variant={rating === "up" ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={rating === "up"}
        aria-label="Helpful"
        onClick={() => send("up")}
      >
        👍
      </Button>
      <Button
        variant={rating === "down" ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={rating === "down"}
        aria-label="Not helpful"
        onClick={() => send("down")}
      >
        👎
      </Button>
      {rating && !failed ? (
        <span className="text-xs text-slate-500">Thanks.</span>
      ) : null}
      {failed ? (
        <span className="text-xs text-red-600">Could not save feedback.</span>
      ) : null}
    </div>
  );
}

export function ChatPanel({
  readyDocumentCount,
  projects,
  initialProjectId = "",
}: {
  readyDocumentCount: number;
  projects: Array<{ id: string; name: string; readyDocumentCount: number }>;
  initialProjectId?: string;
}) {
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState(initialProjectId);

  const selectedReadyDocumentCount = projectId
    ? (projects.find((project) => project.id === projectId)?.readyDocumentCount ?? 0)
    : readyDocumentCount;

  function changeProject(nextProjectId: string) {
    setProjectId(nextProjectId);
    setConversationId(undefined);
    setAnswers([]);
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = question.trim();
    if (trimmed.length < 3 || pending) return;

    setPending(true);
    setError(null);

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
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? "Could not get an answer.");
        return;
      }

      setConversationId(data.conversationId);
      setAnswers((prev) => [{ ...data, question: trimmed }, ...prev]);
      setQuestion("");
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (readyDocumentCount === 0 && answers.length === 0) {
    return (
      <EmptyState
        title={projectId ? "This project has no indexed documents" : "No indexed documents yet"}
        description={
          projectId
            ? "Upload and index a document inside this project before asking questions about it."
            : "Create a project and index at least one document before asking questions."
        }
        action={
          <Link
            href={projectId ? `/projects/${projectId}` : "/projects"}
            className="inline-flex h-10 items-center rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700"
          >
            {projectId ? "Go to project" : "Go to projects"}
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label htmlFor="chat-project" className="mb-1.5 block text-sm font-medium">
              Search scope
            </label>
            <Select
              id="chat-project"
              value={projectId}
              onChange={(event) => changeProject(event.target.value)}
              disabled={pending}
              className="w-full"
            >
              <option value="">All documents ({readyDocumentCount})</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} ({project.readyDocumentCount})
                </option>
              ))}
            </Select>
          </div>
          <label htmlFor="question" className="sr-only">
            Your question
          </label>
          <Textarea
            id="question"
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                void handleSubmit(e);
              }
            }}
            placeholder="e.g. What is the escalation path for a Sev-1 database outage?"
            disabled={pending}
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-xs text-slate-500">
              {selectedReadyDocumentCount} document
              {selectedReadyDocumentCount === 1 ? "" : "s"} indexed in this scope
            </span>
            <Button
              type="submit"
              disabled={
                pending ||
                question.trim().length < 3 ||
                selectedReadyDocumentCount === 0
              }
            >
              {pending ? (
                <>
                  <Spinner className="border-white/40 border-t-white" />
                  Searching…
                </>
              ) : (
                "Ask"
              )}
            </Button>
          </div>
          {selectedReadyDocumentCount === 0 ? (
            <p className="mt-2 text-xs text-amber-700">
              This project has no indexed documents yet.
            </p>
          ) : null}
        </form>
      </Card>

      {error ? <ErrorState message={error} /> : null}

      {answers.map((item) => (
        <Card key={item.messageId} className="p-5">
          <p className="text-sm font-medium text-slate-500">{item.question}</p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {item.refused ? (
              <Badge tone="warning">No supporting evidence</Badge>
            ) : (
              <Badge tone={CONFIDENCE_TONE[item.confidence]}>
                {item.confidence} confidence
              </Badge>
            )}
            <span className="text-xs text-slate-400">
              {(item.latencyMs / 1000).toFixed(1)}s
            </span>
          </div>

          <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap text-pretty">
            {item.answer}
          </p>

          {item.refused ? (
            <p className="mt-3 text-xs text-slate-500">
              Nothing in your indexed documents matched this closely enough to
              answer from. Try rephrasing, or upload a document that covers it.
            </p>
          ) : null}

          {item.citations.length > 0 ? (
            <div className="mt-5">
              <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Sources
              </h3>
              <div className="mt-2 space-y-2">
                {item.citations.map((citation) => (
                  <CitationCard key={citation.chunkId} citation={citation} />
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-5 border-t border-slate-100 pt-4">
            <FeedbackButtons messageId={item.messageId} />
          </div>
        </Card>
      ))}
    </div>
  );
}
