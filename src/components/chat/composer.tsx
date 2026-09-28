"use client";

import { useRef } from "react";
import { ArrowUp } from "lucide-react";
import { Button, QUIET_CONTROL, Select, Spinner, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { ChatFocusState, FocusOptions, ProjectOption } from "./types";

/**
 * Where you type. Three things here are what stop the page reading as a search
 * form:
 *
 * - **Enter sends, Shift+Enter breaks the line.** Cmd/Ctrl+Enter still works for
 *   anyone who learned the old behaviour, but a box you have to hold a modifier
 *   to submit is a text field, not a message composer.
 * - **The scope is an inline control, not a labelled "Search scope" field.** It
 *   sits with the evidence count as one quiet footer, so the question is the
 *   only prominent thing.
 * - **The button says Ask, never "Searching…".** What the pipeline is doing is
 *   reported in the transcript, where the answer will appear.
 */
const MAX_COMPOSER_HEIGHT = 200;

export function Composer({
  value,
  projectId,
  projects,
  readyDocumentCount,
  focus,
  focusOptions,
  pending,
  onChange,
  onProjectChange,
  onFocusChange,
  onSubmit,
  className,
}: {
  value: string;
  projectId: string;
  projects: ProjectOption[];
  readyDocumentCount: number;
  focus: ChatFocusState;
  focusOptions: FocusOptions;
  pending: boolean;
  onChange: (value: string) => void;
  onProjectChange: (projectId: string) => void;
  /** "" | "task:<id>" | "doc:<id>" | "choose-documents" */
  onFocusChange: (value: string) => void;
  onSubmit: () => void;
  className?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const selectedProject = projects.find((project) => project.id === projectId);
  const documentCount = projectId
    ? (selectedProject?.readyDocumentCount ?? 0)
    : readyDocumentCount;
  const recordCount = projectId ? (selectedProject?.liveRecordCount ?? 0) : 0;
  // A focused thread always has evidence to offer: the task record itself, or
  // documents the page already confirmed exist.
  const evidenceCount =
    focus.kind === "none" ? documentCount + recordCount : 1;
  const focusValue =
    focus.kind === "task" && focus.taskId
      ? `task:${focus.taskId}`
      : focus.kind === "documents"
        ? focus.documents.length === 1
          ? `doc:${focus.documents[0].id}`
          : "several-documents"
        : "";
  const canSend = !pending && value.trim().length >= 3 && evidenceCount > 0;

  function grow(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
  }

  function submit() {
    if (!canSend) return;
    onSubmit();
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.focus();
    }
  }

  return (
    <div className={className}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="rounded-2xl border border-slate-300 bg-white p-2 shadow-sm focus-within:border-slate-900"
      >
        <label htmlFor="question" className="sr-only">
          Your question
        </label>
        <Textarea
          id="question"
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            grow(event.target);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            submit();
          }}
          placeholder="Ask about your documents and project records…"
          disabled={pending}
          className="resize-none border-transparent bg-transparent px-2 py-1.5 focus-visible:border-transparent focus-visible:ring-0"
        />

        <div className="mt-1 flex items-center gap-2 px-1">
          <label htmlFor="chat-project" className="sr-only">
            Ask about
          </label>
          <Select
            id="chat-project"
            value={projectId}
            onChange={(event) => onProjectChange(event.target.value)}
            disabled={pending}
            className={cn(QUIET_CONTROL, "h-8 w-auto max-w-[14rem] text-xs")}
          >
            <option value="">All documents</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>

          <label htmlFor="chat-focus" className="sr-only">
            Focus on
          </label>
          <Select
            id="chat-focus"
            value={focusValue}
            onChange={(event) => onFocusChange(event.target.value)}
            disabled={pending}
            className={cn(QUIET_CONTROL, "h-8 w-auto max-w-[14rem] text-xs")}
          >
            <option value="">{projectId ? "Whole project" : "Every document"}</option>
            {focus.kind === "task" && !focus.taskId ? (
              <option value="task:deleted" disabled>
                Deleted task
              </option>
            ) : null}
            {focusOptions.tasks.length > 0 ? (
              <optgroup label="A task">
                {focusOptions.tasks.map((task) => (
                  <option key={task.id} value={`task:${task.id}`}>
                    {task.title}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {focusOptions.documents.length > 0 ? (
              <optgroup label="A document">
                {focusOptions.documents.map((document) => (
                  <option key={document.id} value={`doc:${document.id}`}>
                    {document.filename}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {focusValue === "several-documents" ? (
              <option value="several-documents" disabled>
                {focus.kind === "documents" ? `${focus.documents.length} documents` : ""}
              </option>
            ) : null}
            {focusOptions.documents.length > 1 ? (
              <option value="choose-documents">Several documents…</option>
            ) : null}
          </Select>

          <span className="hidden min-w-0 truncate text-xs text-slate-500 sm:inline">
            {focus.kind !== "none" ? "" : projectId
              ? `${documentCount} document${documentCount === 1 ? "" : "s"} · ${recordCount} record${recordCount === 1 ? "" : "s"}`
              : `${documentCount} document${documentCount === 1 ? "" : "s"} indexed`}
          </span>

          <Button
            type="submit"
            size="icon"
            disabled={!canSend}
            aria-label="Ask"
            className="ml-auto rounded-full"
          >
            {pending ? (
              <Spinner className="size-3.5 border-white/40 border-t-white" />
            ) : (
              <ArrowUp className="size-4" aria-hidden />
            )}
          </Button>
        </div>
      </form>

      {evidenceCount === 0 ? (
        <p className="mt-2 px-1 text-xs text-amber-700">
          This scope has no indexed documents or approved project records yet.
        </p>
      ) : (
        <p className="mt-2 px-1 text-xs text-slate-400">
          {focus.kind === "task"
            ? "Answers come from this task, its connected records, and its linked documents, and can propose edits you apply."
            : focus.kind === "documents"
              ? "Answers come only from the chosen documents."
              : projectId
                ? "Answers combine this project's documents with its current approved records, and cite both. Pick a task or document to narrow it."
                : "Answers come from your indexed documents. Pick a project to include its live records."}
          {" Enter to send, Shift+Enter for a new line."}
        </p>
      )}
    </div>
  );
}
