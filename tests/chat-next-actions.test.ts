import { describe, expect, it } from "vitest";
import { nextActionsFor } from "@/lib/chat/next-actions";
import type { Citation, ProjectCitation } from "@/lib/schemas";

/**
 * Next actions are derived, not stored: a replayed turn must produce the same
 * links from the same citations, with no model call and no extra query.
 */

function documentCitation(documentId: string, filename: string): Citation {
  return {
    kind: "document",
    label: "S1",
    chunkId: `chunk-${documentId}-${filename}`,
    documentId,
    filename,
    pageNumber: null,
    sectionTitle: null,
    excerpt: "…",
    score: 0.7,
    matchType: "semantic",
  };
}

function projectCitation(
  kind: ProjectCitation["kind"],
  href: string,
): Citation {
  return {
    kind,
    label: "T1",
    title: "A record",
    excerpt: "…",
    observedAt: "2026-08-06T00:00:00.000Z",
    href,
    snapshot: {},
  };
}

describe("nextActionsFor", () => {
  it("sends a document citation to that document", () => {
    expect(nextActionsFor([documentCitation("doc-1", "runbook.md")])).toEqual([
      { label: "Open runbook.md", href: "/documents/doc-1" },
    ]);
  });

  it("maps each live record kind to its section", () => {
    const actions = nextActionsFor([
      projectCitation("milestone", "/projects/p1/timeline"),
      projectCitation("risk", "/projects/p1/risks"),
      projectCitation("requirement", "/projects/p1/requirements"),
      projectCitation("project_snapshot", "/projects/p1"),
    ]);

    expect(actions).toEqual([
      { label: "Open the timeline", href: "/projects/p1/timeline" },
      { label: "Open the risk register", href: "/projects/p1/risks" },
      { label: "Open the requirements register", href: "/projects/p1/requirements" },
      { label: "Open the project overview", href: "/projects/p1" },
    ]);
  });

  it("collapses several chunks of one document into a single link", () => {
    const actions = nextActionsFor([
      documentCitation("doc-1", "runbook.md"),
      documentCitation("doc-1", "runbook.md"),
      documentCitation("doc-1", "runbook.md"),
    ]);

    expect(actions).toHaveLength(1);
  });

  it("collapses a task and a dependency, which share the board", () => {
    const actions = nextActionsFor([
      projectCitation("task", "/projects/p1/tasks"),
      projectCitation("dependency", "/projects/p1/tasks"),
    ]);

    expect(actions).toEqual([{ label: "Open in Tasks", href: "/projects/p1/tasks" }]);
  });

  it("keeps first-seen order, which is the model's citation order", () => {
    const actions = nextActionsFor([
      projectCitation("risk", "/projects/p1/risks"),
      documentCitation("doc-1", "runbook.md"),
    ]);

    expect(actions.map((action) => action.href)).toEqual([
      "/projects/p1/risks",
      "/documents/doc-1",
    ]);
  });

  it("caps at four so the row stays a next step, not a toolbar", () => {
    const actions = nextActionsFor([
      documentCitation("doc-1", "a.md"),
      documentCitation("doc-2", "b.md"),
      documentCitation("doc-3", "c.md"),
      documentCitation("doc-4", "d.md"),
      documentCitation("doc-5", "e.md"),
    ]);

    expect(actions).toHaveLength(4);
  });

  it("gives a refusal nothing to act on", () => {
    // A refusal always carries citations: [], so this falls out for free.
    expect(nextActionsFor([])).toEqual([]);
  });

  it("never produces an off-site link", () => {
    const actions = nextActionsFor([
      documentCitation("doc-1", "runbook.md"),
      projectCitation("task", "/projects/p1/tasks"),
    ]);

    expect(actions.every((action) => action.href.startsWith("/"))).toBe(true);
  });

  it("needs no project context, so a global answer works unchanged", () => {
    // Every project href comes off the citation; document hrefs are built from
    // the document id. There is no projectId argument to forget to pass.
    expect(nextActionsFor([documentCitation("doc-1", "runbook.md")])).toHaveLength(1);
  });
});
