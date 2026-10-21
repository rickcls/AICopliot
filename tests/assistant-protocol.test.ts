import { describe, expect, it } from "vitest";
import {
  assistantSystemPrompt,
  finalizeAnswer,
  parseStep,
  SourceRegistry,
  stripLabels,
  toPublicSources,
  toolsForTurn,
  validateAssistantProposals,
} from "@/lib/assistant/protocol";

function registry() {
  const r = new SourceRegistry();
  r.add("U", "question", (label) => ({ label, kind: "question" as const, content: "幫我開個task，聽日要交報價俾ABC" }));
  r.add("P", "project:p1", (label) => ({ label, kind: "project" as const, projectId: "p1", name: "Sales" }));
  r.add("S", "chunk:c1", (label) => ({
    label,
    kind: "document" as const,
    documentId: "d1",
    chunkId: "c1",
    filename: "quote.pdf",
    pageNumber: 2,
    content: "The quotation is valid until 30 November.",
  }));
  r.add("T", "task:t1", (label) => ({
    label,
    kind: "task" as const,
    taskId: "t1",
    projectId: "p1",
    title: "Send ABC quotation",
    category: "open" as const,
    dueDate: "2026-10-20",
    priority: "high" as const,
    facts: "Send ABC quotation | project Sales | status open | due 2026-10-20",
  }));
  return r;
}

describe("parseStep", () => {
  it("reads a tool call", () => {
    expect(parseStep('{"action":"list_my_tasks","input":{"filter":"week"}}')).toEqual({
      kind: "tool",
      tool: "list_my_tasks",
      input: { filter: "week" },
    });
  });

  it("reads an answer, fenced or not", () => {
    expect(parseStep('```json\n{"action":"answer","answer":"Due Friday [T1]","citations":["T1"]}\n```')).toMatchObject({
      kind: "answer",
      answer: "Due Friday [T1]",
      citations: ["T1"],
      general: false,
      proposals: [],
    });
  });

  it("names an unknown tool rather than running it", () => {
    expect(parseStep('{"action":"send_email","input":{}}')).toEqual({ kind: "unknown_tool", action: "send_email" });
  });

  it("offers web search only on a turn whose switch is on", () => {
    const call = '{"action":"search_web","input":{"query":"ABC quotation"}}';
    expect(parseStep(call, toolsForTurn(false))).toEqual({ kind: "unknown_tool", action: "search_web" });
    expect(parseStep(call, toolsForTurn(true))).toMatchObject({ kind: "tool", tool: "search_web" });
    expect(assistantSystemPrompt(false)).not.toContain("search_web");
    expect(assistantSystemPrompt(true)).toContain("search_web");
    expect(assistantSystemPrompt(false)).toContain("find_tasks");
    expect(assistantSystemPrompt(false)).toContain("Do not tell the person you are unable");
    expect(assistantSystemPrompt(false)).not.toContain("You cannot change anything");
  });

  it("returns null for anything that is not one valid step", () => {
    expect(parseStep("I will now search")).toBeNull();
    expect(parseStep('{"action":"answer","answer":""}')).toBeNull();
  });
});

describe("SourceRegistry", () => {
  it("labels per kind and keeps a record's first label", () => {
    const r = registry();
    const again = r.add("T", "task:t1", (label) => ({
      label,
      kind: "task" as const,
      taskId: "t1",
      projectId: "p1",
      title: "x",
      category: "open" as const,
      dueDate: null,
      priority: "low" as const,
      facts: "x",
    }));
    expect(again.label).toBe("T1");
    expect(r.all().map((source) => source.label)).toEqual(["U1", "P1", "S1", "T1"]);
  });
});

describe("finalizeAnswer", () => {
  it("drops labels the run never issued and keeps the rest as citations", () => {
    const result = finalizeAnswer("Valid until 30 Nov [S1, S9]. Due 20 Oct [T7].", [], false, registry(), "en");
    expect(result.content).toBe("Valid until 30 Nov [S1]. Due 20 Oct .");
    expect(result.used).toEqual(["S1"]);
    expect(result.general).toBe(false);
  });

  it("treats a web page the run returned as evidence, and drops one it never issued", () => {
    const r = registry();
    r.add("W", "web:https://example.com/a", (label) => ({
      label,
      kind: "web" as const,
      title: "ABC quotation guide",
      url: "https://example.com/a",
      excerpt: "A public snippet.",
    }));
    const result = finalizeAnswer("See the guide [W1, W9].", [], false, r, "en");
    expect(result.content).toBe("See the guide [W1].");
    expect(result.used).toEqual(["W1"]);
    expect(result.general).toBe(false);
    expect(toPublicSources(r, result.used)).toEqual([
      { label: "W1", kind: "web", title: "ABC quotation guide", url: "https://example.com/a", excerpt: "A public snippet." },
    ]);
  });

  it("calls an answer general when it cites no source, whatever the model says", () => {
    expect(finalizeAnswer("Try a weekly review.", [], false, registry(), "en").general).toBe(true);
    expect(finalizeAnswer("In Sales [P1].", ["U1"], false, registry(), "en").general).toBe(true);
    expect(finalizeAnswer("Valid [S1].", [], true, registry(), "en").general).toBe(true);
  });

  it("writes Chinese answers in Traditional characters", () => {
    expect(finalizeAnswer("报价有效至十一月 [S1]", [], false, registry(), "zh-Hant").content).toBe("報價有效至十一月 [S1]");
  });

  it("keeps only linkable facts in what is stored", () => {
    const sources = toPublicSources(registry(), ["S1", "T1", "U1"]);
    expect(sources).toEqual([
      expect.objectContaining({ label: "S1", kind: "document", documentId: "d1", chunkId: "c1" }),
      { label: "T1", kind: "task", taskId: "t1", projectId: "p1", title: "Send ABC quotation" },
    ]);
  });

  it("strips labels from history, which carries wording only", () => {
    expect(stripLabels("Due Friday [T2] per the quote [S1, S3].")).toBe("Due Friday per the quote .");
  });
});

describe("validateAssistantProposals", () => {
  it("accepts a task the person asked for, with the date computed from their words", () => {
    const [proposal] = validateAssistantProposals(
      [
        {
          kind: "create_task",
          title: "Send quotation to ABC",
          description: null,
          project: "P1",
          priority: null,
          due: { phrase: "聽日", date: "2026-10-17" },
          estimatedHours: null,
          citations: ["U1"],
        },
      ],
      registry(),
      "2026-10-16",
      "en",
    );
    expect(proposal).toMatchObject({
      kind: "create_task",
      payload: { projectId: "p1", dueDate: "2026-10-17", duePhrase: "聽日" },
      flags: [],
    });
  });

  it("resolves tasks only through the run's labels, and needs a real citation", () => {
    const proposals = validateAssistantProposals(
      [
        { kind: "update_task", task: "T1", status: "done", priority: null, due: null, citations: ["S1"] },
        { kind: "update_task", task: "T9", status: "done", priority: null, due: null, citations: ["U1"] },
        { kind: "add_note", task: "T1", note: "Chased ABC", citations: ["N4"] },
      ],
      registry(),
      "2026-10-16",
      "en",
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ kind: "update_task", taskId: "t1", payload: { status: "done" } });
  });

  it("keeps a priority, a due date, and a comment taken from the person's own words", () => {
    const r = new SourceRegistry();
    r.add("U", "question", (label) => ({
      label,
      kind: "question" as const,
      content: "把提交月報改成緊急，下星期五前要交，備註：已跟進 Peter",
    }));
    r.add("T", "task:report", (label) => ({
      label,
      kind: "task" as const,
      taskId: "task-report",
      projectId: "p1",
      title: "提交月報",
      category: "open" as const,
      dueDate: null,
      priority: "medium" as const,
      facts: "提交月報 | status open | due none | priority medium",
    }));

    const proposals = validateAssistantProposals(
      [
        {
          kind: "update_task",
          task: "T1",
          status: null,
          priority: "urgent",
          due: { phrase: "下星期五", date: "2026-10-23" },
          citations: ["U1"],
        },
        { kind: "add_note", task: "T1", note: "已跟進 Peter", citations: ["U1"] },
      ],
      r,
      "2026-10-16",
      "zh-Hant",
    );

    expect(proposals).toHaveLength(2);
    expect(proposals[0]).toMatchObject({
      kind: "update_task",
      taskId: "task-report",
      payload: { priority: "urgent", dueDate: "2026-10-23", duePhrase: "下星期五" },
      flags: [],
    });
    expect(proposals[1]).toMatchObject({ kind: "add_note", taskId: "task-report", payload: { note: "已跟進 Peter" } });
  });
});
