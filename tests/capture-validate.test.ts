import { describe, expect, it } from "vitest";
import { splitCaptureLines } from "@/lib/capture/lines";
import {
  MAX_CAPTURE_PROPOSALS,
  validateCaptureProposals,
  type CandidateRef,
  type CaptureValidationContext,
} from "@/lib/capture/validate";

/**
 * The deterministic gate between the model and the person. Every rule here is
 * one the model was asked to follow and is not trusted to.
 */

const { lines } = splitCaptureLines(
  "聽日下晝3點前要send報價俾ABC公司\n上個禮拜嘅月報已經交咗\n等緊Peter覆個contract\nBudget review takes 3 hours, due 23/10",
);
// C1 聽日… / C2 月報 / C3 contract / C4 budget

const tasks = new Map<string, CandidateRef>([
  ["T1", { id: "task-report", title: "提交月報", category: "open", dueDate: "2026-10-10", priority: "medium" }],
  ["T2", { id: "task-contract", title: "Follow up contract", category: "open", dueDate: null, priority: "high" }],
  ["T3", { id: "task-done", title: "Old work", category: "done", dueDate: null, priority: "low" }],
]);

const ctx: CaptureValidationContext = {
  lines,
  tasks,
  projects: new Map([["P1", "project-abc"]]),
  anchor: "2026-10-16",
  language: "zh-Hant",
};

const create = (overrides: Record<string, unknown> = {}) => ({
  kind: "create_task",
  title: "Send quote to ABC",
  description: null,
  project: "P1",
  priority: null,
  due: { phrase: "聽日", date: "2026-10-17" },
  estimatedHours: null,
  citations: ["C1"],
  ...overrides,
});

describe("validateCaptureProposals", () => {
  it("keeps a cited task, resolves its project label and recomputes its date", () => {
    const { proposals, dropped } = validateCaptureProposals([create()], ctx);
    expect(dropped).toEqual([]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      kind: "create_task",
      taskId: null,
      flags: [],
      citations: [{ label: "C1", text: lines[0].text }],
      payload: { projectId: "project-abc", dueDate: "2026-10-17", duePhrase: "聽日" },
    });
  });

  it("drops a proposal with no real citation", () => {
    const { proposals, dropped } = validateCaptureProposals(
      [create({ citations: [] }), create({ citations: ["C99", "S1"] })],
      ctx,
    );
    expect(proposals).toEqual([]);
    expect(dropped.map((entry) => entry.reason)).toEqual(["uncited", "uncited"]);
  });

  it("never resolves an invented task or project label", () => {
    const { proposals, dropped } = validateCaptureProposals(
      [
        { kind: "update_task", task: "T9", status: "done", priority: null, due: null, citations: ["C2"] },
        create({ project: "P7" }),
      ],
      ctx,
    );
    expect(dropped).toEqual([{ index: 0, reason: "unknown_task" }]);
    expect(proposals[0].kind === "create_task" && proposals[0].payload.projectId).toBeNull();
  });

  it("drops a date whose words are not in the cited lines", () => {
    const { proposals } = validateCaptureProposals(
      [create({ due: { phrase: "下星期五", date: "2026-10-23" } })],
      ctx,
    );
    expect(proposals[0].kind === "create_task" && proposals[0].payload.dueDate).toBeNull();
  });

  it("drops a vague date instead of guessing one", () => {
    const vague = splitCaptureLines("遲啲要整理份文件");
    const { proposals } = validateCaptureProposals(
      [create({ citations: ["C1"], due: { phrase: "遲啲", date: "2026-10-20" } })],
      { ...ctx, lines: vague.lines },
    );
    expect(proposals[0].kind === "create_task" && proposals[0].payload.dueDate).toBeNull();
  });

  it("uses the server's date and flags the disagreement", () => {
    const { proposals } = validateCaptureProposals(
      [create({ due: { phrase: "聽日", date: "2026-10-18" } })],
      ctx,
    );
    expect(proposals[0].flags).toContain("date_check");
    expect(proposals[0].kind === "create_task" && proposals[0].payload.dueDate).toBe("2026-10-17");
  });

  it("keeps an estimate only when the cited text states it", () => {
    const { proposals } = validateCaptureProposals(
      [
        create({ title: "Budget review", citations: ["C4"], due: null, estimatedHours: 3 }),
        create({ title: "Budget review 2", citations: ["C4"], due: null, estimatedHours: 5 }),
      ],
      ctx,
    );
    const estimates = proposals.map((p) => (p.kind === "create_task" ? p.payload.estimatedHours : null));
    expect(estimates).toEqual([3, null]);
  });

  it("flags a likely duplicate of an open task instead of dropping it", () => {
    const { proposals } = validateCaptureProposals([create({ title: "提交 月報", citations: ["C2"], due: null })], ctx);
    expect(proposals[0].flags).toContain("possible_duplicate");
  });

  it("drops an update that changes nothing", () => {
    const { proposals, dropped } = validateCaptureProposals(
      [
        { kind: "update_task", task: "T3", status: "done", priority: null, due: null, citations: ["C2"] },
        { kind: "update_task", task: "T2", status: null, priority: "high", due: null, citations: ["C3"] },
      ],
      ctx,
    );
    expect(proposals).toEqual([]);
    expect(dropped.map((entry) => entry.reason)).toEqual(["noop", "noop"]);
  });

  it("starts a new task blocked only when the cited line says they are waiting", () => {
    const waiting = splitCaptureLines("等緊Peter覆個contract\n下星期要處理續約");
    const { proposals } = validateCaptureProposals(
      [
        create({
          title: "跟進 Peter 覆 contract",
          citations: ["C1"],
          due: null,
          project: null,
          status: "blocked",
        }),
        create({
          title: "處理續約",
          citations: ["C2"],
          due: { phrase: "下星期", date: "2026-10-23" },
          project: null,
          status: "blocked",
        }),
        create({ title: "Send quote to ABC", status: "done" }),
      ],
      { ...ctx, lines: waiting.lines },
    );
    expect(proposals).toHaveLength(3);
    expect(proposals[0].kind === "create_task" && proposals[0].payload).toMatchObject({
      status: "blocked",
      dueDate: null,
    });
    expect(proposals[1].kind === "create_task" && proposals[1].payload).toMatchObject({
      status: null,
      dueDate: null,
    });
    expect(proposals[2].kind === "create_task" && proposals[2].payload.status).toBeNull();
  });

  it("keeps a real status change on the right task", () => {
    const { proposals } = validateCaptureProposals(
      [{ kind: "update_task", task: "T1", status: "done", priority: null, due: null, citations: ["C2"] }],
      ctx,
    );
    expect(proposals[0]).toMatchObject({
      kind: "update_task",
      taskId: "task-report",
      payload: { status: "done", dueDate: null },
    });
  });

  it("keeps a progress note and converts it to Traditional characters", () => {
    const { proposals } = validateCaptureProposals(
      [{ kind: "add_note", task: "T2", note: "等紧Peter回复合同", citations: ["C3"] }],
      ctx,
    );
    expect(proposals[0]).toMatchObject({ kind: "add_note", taskId: "task-contract" });
    expect(proposals[0].kind === "add_note" && proposals[0].payload.note).toBe("等緊Peter回覆合同");
  });

  it("never converts the quoted source lines", () => {
    const simplified = splitCaptureLines("这个报告聽日要交");
    const { proposals } = validateCaptureProposals(
      [create({ title: "交这个报告", citations: ["C1"] })],
      { ...ctx, lines: simplified.lines },
    );
    expect(proposals[0].citations[0].text).toBe("这个报告聽日要交");
    expect(proposals[0].kind === "create_task" && proposals[0].payload.title).toBe("交這個報告");
  });

  it("drops malformed items without losing the good ones", () => {
    const { proposals, dropped } = validateCaptureProposals(
      [{ kind: "delete_everything" }, "nonsense", create()],
      ctx,
    );
    expect(proposals).toHaveLength(1);
    expect(dropped.map((entry) => entry.reason)).toEqual(["malformed", "malformed"]);
  });

  it("caps the number of proposals", () => {
    const many = Array.from({ length: MAX_CAPTURE_PROPOSALS + 3 }, (_, i) =>
      create({ title: `Task ${i}`, due: null }),
    );
    const { proposals, dropped } = validateCaptureProposals(many, ctx);
    expect(proposals).toHaveLength(MAX_CAPTURE_PROPOSALS);
    expect(dropped.filter((entry) => entry.reason === "over_limit")).toHaveLength(3);
  });
});
