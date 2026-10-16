import { describe, expect, it } from "vitest";
import {
  buildDayPlanUserMessage,
  describeDue,
  validateDayPlan,
  type PlanCandidate,
} from "@/lib/today/plan";

const candidate = (label: string, taskId: string, estimateMinutes: number | null = null): PlanCandidate => ({
  label,
  taskId,
  title: `Task ${label}`,
  project: "Ops",
  status: "open",
  due: "due today",
  priority: "high",
  estimateMinutes,
  quietDays: 0,
});

const candidates = new Map([
  ["T1", candidate("T1", "task-1")],
  ["T2", candidate("T2", "task-2", 90)],
  ["T3", candidate("T3", "task-3")],
]);

describe("validateDayPlan", () => {
  it("keeps real candidates once each, in the model's order", () => {
    const plan = validateDayPlan(
      {
        summary: "Busy day",
        items: [
          { task: "T3", minutes: 30, reason: "First" },
          { task: "T9", minutes: 30, reason: "Invented" },
          { task: "T3", minutes: 30, reason: "Again" },
          { task: "T1", minutes: 45, reason: "Then" },
        ],
      },
      candidates,
      480,
      "en",
    );
    expect(plan.items.map((item) => item.taskId)).toEqual(["task-3", "task-1"]);
    expect(plan.dropped).toBe(2);
  });

  it("uses the person's own estimate over the model's", () => {
    const plan = validateDayPlan(
      { summary: "", items: [{ task: "T2", minutes: 20, reason: "" }] },
      candidates,
      480,
      "en",
    );
    expect(plan.items[0].minutes).toBe(90);
  });

  it("clamps silly blocks and stops at the first one that overruns the time", () => {
    const plan = validateDayPlan(
      {
        summary: "",
        items: [
          { task: "T1", minutes: 2, reason: "" },
          { task: "T2", minutes: 0, reason: "" },
          { task: "T3", minutes: 60, reason: "" },
        ],
      },
      candidates,
      100,
      "en",
    );
    expect(plan.items.map((item) => [item.taskId, item.minutes])).toEqual([
      ["task-1", 5],
      ["task-2", 90],
    ]);
    expect(plan.items.reduce((sum, item) => sum + item.minutes, 0)).toBeLessThanOrEqual(100);
  });

  it("converts the model's prose to Traditional characters for Chinese", () => {
    const plan = validateDayPlan(
      { summary: "今天先处理报价", items: [{ task: "T1", minutes: 30, reason: "客户在等" }] },
      candidates,
      480,
      "zh-Hant",
    );
    expect(plan.summary).toBe("今天先處理報價");
    expect(plan.items[0].reason).toBe("客户在等");
  });
});

describe("the planner's input", () => {
  const today = new Date("2026-10-16T00:00:00Z");

  it("describes due dates relative to the viewer's day", () => {
    expect(describeDue(null, today)).toBe("no due date");
    expect(describeDue(new Date("2026-10-13T00:00:00Z"), today)).toBe("overdue 3 days");
    expect(describeDue(new Date("2026-10-16T00:00:00Z"), today)).toBe("due today");
    expect(describeDue(new Date("2026-10-17T00:00:00Z"), today)).toBe("due in 1 day");
    expect(describeDue(new Date("2026-11-03T00:00:00Z"), today)).toBe("due 2026-11-03");
  });

  it("names tasks by label only", () => {
    const message = buildDayPlanUserMessage({
      today: "2026-10-16",
      availableMinutes: 360,
      note: "meeting 2-4pm",
      candidates: [...candidates.values()],
      language: "en",
    });
    expect(message).toContain("T1: Task T1");
    expect(message).toContain("AVAILABLE: 360 minutes");
    expect(message).not.toContain("task-1");
  });
});
