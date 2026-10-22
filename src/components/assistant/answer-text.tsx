import Link from "next/link";
import type { PublicSource } from "@/lib/assistant/protocol";

const LABEL_GROUP = /\[((?:[A-Z]\d{1,3})(?:\s*[,，、]\s*[A-Z]\d{1,3})*)\]/g;

export function sourceHref(source: PublicSource): string {
  switch (source.kind) {
    case "document":
      return `/documents/${source.documentId}/chunks?chunk=${source.chunkId}#chunk-${source.chunkId}`;
    case "task":
      return `/projects/${source.projectId}/tasks?task=${source.taskId}`;
    case "note":
      return `/capture#capture-${source.captureId}`;
    case "draft":
      return `/email?draft=${source.draftId}`;
    case "project":
      return `/projects/${source.projectId}`;
    case "web":
      return source.url;
  }
}

export function sourceTitle(source: PublicSource): string {
  switch (source.kind) {
    case "document":
      return `${source.filename}${source.pageNumber !== null ? ` · p.${source.pageNumber}` : ""}\n${source.excerpt}`;
    case "task":
      return source.title;
    case "note":
      return source.excerpt;
    case "draft":
      return source.subject;
    case "project":
      return source.name;
    case "web":
      return `${source.title}\n${source.url}`;
  }
}

/**
 * The assistant's answer with each label turned into a link to what it cites.
 * Labels were already checked on the server — any the run never issued were
 * removed — so every chip here leads somewhere real.
 */
export function AnswerText({ content, sources }: { content: string; sources: PublicSource[] }) {
  const byLabel = new Map(sources.map((source) => [source.label, source]));
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of content.matchAll(LABEL_GROUP)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(content.slice(last, at));
    for (const label of match[1].split(/\s*[,，、]\s*/)) {
      const source = byLabel.get(label);
      parts.push(
        source ? (
          <Citation key={`${at}-${label}`} source={source} label={label} />
        ) : null,
      );
    }
    last = at + match[0].length;
  }
  if (last < content.length) parts.push(content.slice(last));
  return <p className="text-[15px] leading-7 whitespace-pre-wrap text-sand-800">{parts}</p>;
}

const CHIP =
  "mx-0.5 inline-flex rounded bg-sand-100 px-1 align-baseline font-mono text-[11px] text-sand-600 hover:bg-sand-200 hover:text-sand-900";

function Citation({ source, label }: { source: PublicSource; label: string }) {
  if (source.kind === "web") {
    return (
      <a href={source.url} target="_blank" rel="noopener noreferrer" title={sourceTitle(source)} className={CHIP}>
        {label}
      </a>
    );
  }
  return (
    <Link href={sourceHref(source)} title={sourceTitle(source)} className={CHIP}>
      {label}
    </Link>
  );
}
