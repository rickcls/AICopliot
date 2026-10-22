"use client";

import { useT } from "@/components/i18n-provider";
import { parseAnswer, type Inline } from "@/lib/chat/markdown";
import { FOCUS_RING } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * The answer, rendered from parsed data rather than markup — React escapes every
 * string, so there is no `dangerouslySetInnerHTML` and nothing to sanitise.
 *
 * The inline `[S1]` references the prompt requires become chips that jump to the
 * matching source card, which is what turns a wall of prose with stray label
 * noise in it into something you can check.
 */

function sourceAnchorId(messageId: string, label: string) {
  return `src-${messageId}-${label}`;
}

function CitationChip({
  messageId,
  label,
}: {
  messageId: string;
  label: string;
}) {
  const targetId = sourceAnchorId(messageId, label);
  const t = useT();

  return (
    <a
      href={`#${targetId}`}
      aria-label={t("chat.source.jump", { label })}
      onClick={(event) => {
        // A bare hash link pushes a history entry and jumps abruptly; the back
        // button then walks through every citation the reader glanced at.
        event.preventDefault();
        const target = document.getElementById(targetId);
        if (!target) return;
        target.scrollIntoView({ block: "nearest", behavior: "smooth" });
        target.classList.add("ring-2", "ring-sand-900");
        window.setTimeout(
          () => target.classList.remove("ring-2", "ring-sand-900"),
          1200,
        );
      }}
      className={cn(
        "mx-0.5 inline-flex items-center rounded border border-sand-300 bg-sand-50 px-1 align-baseline",
        "font-mono text-[10px] font-medium text-sand-600 transition-colors hover:bg-sand-200 hover:text-sand-900",
        FOCUS_RING,
      )}
    >
      {label}
    </a>
  );
}

function Inlines({
  inlines,
  messageId,
}: {
  inlines: Inline[];
  messageId: string;
}) {
  return (
    <>
      {inlines.map((inline, index) => {
        switch (inline.type) {
          case "citation":
            return (
              <CitationChip
                key={index}
                messageId={messageId}
                label={inline.label}
              />
            );
          case "code":
            return (
              <code
                key={index}
                className="rounded bg-sand-100 px-1 py-0.5 font-mono text-[0.85em] text-sand-800"
              >
                {inline.value}
              </code>
            );
          case "strong":
            return (
              <strong key={index} className="font-semibold text-sand-900">
                {inline.value}
              </strong>
            );
          default:
            return <span key={index}>{inline.value}</span>;
        }
      })}
    </>
  );
}

export function AnswerBody({
  messageId,
  text,
  citations,
}: {
  messageId: string;
  text: string;
  /** Only labels this answer actually kept may become chips. */
  citations: { label?: string }[];
}) {
  const knownLabels = citations
    .map((citation) => citation.label)
    .filter((label): label is string => Boolean(label));
  const blocks = parseAnswer(text, knownLabels);

  return (
    <div className="space-y-3 text-[15px] leading-7 text-pretty text-sand-800">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "heading":
            return (
              <h3
                key={index}
                className="pt-1 text-xs font-semibold tracking-wide text-sand-900 uppercase"
              >
                {block.text}
              </h3>
            );
          case "code":
            return (
              <pre
                key={index}
                className="overflow-x-auto rounded-lg bg-sand-900 px-3 py-2 font-mono text-xs text-sand-100"
              >
                <code>{block.value}</code>
              </pre>
            );
          case "list": {
            const List = block.ordered ? "ol" : "ul";
            return (
              <List
                key={index}
                className={cn(
                  "space-y-1 pl-5",
                  block.ordered ? "list-decimal" : "list-disc",
                )}
              >
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="pl-1">
                    <Inlines inlines={item} messageId={messageId} />
                  </li>
                ))}
              </List>
            );
          }
          default:
            return (
              <p key={index}>
                <Inlines inlines={block.inlines} messageId={messageId} />
              </p>
            );
        }
      })}
    </div>
  );
}

export { sourceAnchorId };
