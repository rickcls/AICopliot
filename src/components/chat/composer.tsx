"use client";

import { useRef } from "react";
import { ArrowUp, Crosshair, FileText, Files, FolderKanban, Library, SquareCheck } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { PillSelect, type PillOption } from "@/components/property-pill";
import { projectOptions } from "@/components/task-field-options";
import { Button, Spinner, Textarea } from "@/components/ui";
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
  const t = useT();

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
  const wholeLabel = projectId ? t("chat.composer.wholeProject") : t("chat.composer.everyDocument");
  const focusMenu: PillOption[] = [
    {
      value: "",
      label: wholeLabel,
      content: (
        <>
          <Library aria-hidden className="size-4 shrink-0 text-sand-400" />
          <span className="truncate">{wholeLabel}</span>
        </>
      ),
    },
    ...(focus.kind === "task" && !focus.taskId
      ? [{ value: "task:deleted", label: t("chat.composer.deletedTask"), disabled: true }]
      : []),
    ...focusOptions.tasks.map((task) => ({
      value: `task:${task.id}`,
      label: task.title,
      group: t("chat.composer.aTask"),
      content: (
        <>
          <SquareCheck aria-hidden className="size-4 shrink-0 text-sand-400" />
          <span className="truncate">{task.title}</span>
        </>
      ),
    })),
    ...focusOptions.documents.map((document) => ({
      value: `doc:${document.id}`,
      label: document.filename,
      group: t("chat.composer.aDocument"),
      content: (
        <>
          <FileText aria-hidden className="size-4 shrink-0 text-sand-400" />
          <span className="truncate">{document.filename}</span>
        </>
      ),
    })),
    ...(focus.kind === "documents" && focusValue === "several-documents"
      ? [
          {
            value: "several-documents",
            label: t("chat.composer.documentsCount", { count: focus.documents.length }),
            disabled: true,
          },
        ]
      : []),
    ...(focusOptions.documents.length > 1
      ? [
          {
            value: "choose-documents",
            label: t("chat.composer.severalDocuments"),
            content: (
              <>
                <Files aria-hidden className="size-4 shrink-0 text-sand-400" />
                <span className="truncate">{t("chat.composer.severalDocuments")}</span>
              </>
            ),
          },
        ]
      : []),
  ];
  const canSend =!pending && value.trim().length >= 3 && evidenceCount > 0;

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
        className="rounded-2xl border border-sand-200/80 bg-white p-2 shadow-soft transition-shadow focus-within:border-brand-300 focus-within:ring-4 focus-within:ring-brand-100/70"
      >
        <label htmlFor="question" className="sr-only">
          {t("chat.composer.question")}
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
          placeholder={t("chat.composer.placeholder")}
          disabled={pending}
          className="resize-none border-transparent bg-transparent px-2 py-1.5 text-[15px] leading-relaxed focus-visible:border-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
        />

        {/* Wraps and lets the pickers shrink: at phone width two pickers and
            the send button are wider than the composer, and the row pushed the
            whole page sideways. */}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
          <span id="chat-project-label" className="sr-only">
            {t("chat.composer.askAbout")}
          </span>
          <PillSelect
            id="chat-project"
            icon={<FolderKanban className="size-3.5 opacity-70" />}
            value={projectId}
            options={[
              {
                value: "",
                label: t("chat.composer.allDocuments"),
                content: (
                  <>
                    <Library aria-hidden className="size-4 shrink-0 text-sand-400" />
                    <span className="truncate">{t("chat.composer.allDocuments")}</span>
                  </>
                ),
              },
              ...projectOptions(projects),
            ]}
            onValueChange={onProjectChange}
            disabled={pending}
            className="h-7 max-w-[14rem] shrink text-xs"
          />

          <span id="chat-focus-label" className="sr-only">
            {t("chat.composer.focusOn")}
          </span>
          <PillSelect
            id="chat-focus"
            icon={<Crosshair className="size-3.5 opacity-70" />}
            value={focusValue}
            options={focusMenu}
            onValueChange={onFocusChange}
            disabled={pending}
            className="h-7 max-w-[14rem] shrink text-xs"
          />

          <span className="hidden min-w-0 truncate text-xs text-sand-500 sm:inline">
            {focus.kind !== "none"
              ? ""
              : projectId
                ? t("chat.composer.projectEvidence", {
                    documents: t("chat.composer.documents", { count: documentCount }),
                    records: t("chat.composer.records", { count: recordCount }),
                  })
                : t("chat.composer.indexed", { count: documentCount })}
          </span>

          <Button
            type="submit"
            size="icon"
            disabled={!canSend}
            aria-label={t("chat.composer.ask")}
            className="ml-auto rounded-full"
          >
            {pending ? (
              <Spinner inverse className="size-3.5" />
            ) : (
              <ArrowUp className="size-4" aria-hidden />
            )}
          </Button>
        </div>
      </form>

      {evidenceCount === 0 ? (
        <p className="mt-2 px-1 text-xs text-amber-700">
          {t("chat.composer.noEvidence")}
        </p>
      ) : (
        <p className="mt-2 px-1 text-xs text-sand-400">
          {focus.kind === "task"
            ? t("chat.composer.hintTask")
            : focus.kind === "documents"
              ? t("chat.composer.hintDocuments")
              : projectId
                ? t("chat.composer.hintProject")
                : t("chat.composer.hintAll")}
          {` ${t("chat.composer.keys")}`}
        </p>
      )}
    </div>
  );
}
