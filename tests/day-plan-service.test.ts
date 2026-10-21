import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The day plan against a mocked Prisma and a fake model: a next batch leaves
 * out what today's plan already holds and is added after it, and each item's
 * mark is read from its task as it is now.
 */

const mockPrisma = {
  dailyPlan: { findFirst: vi.fn(), upsert: vi.fn() },
  task: { findMany: vi.fn() },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/auth-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-guard")>()),
  getUserPreferences: vi.fn(async () => ({ locale: "en", timeZone: "Asia/Hong_Kong" })),
}));
const mockOpenTasks = vi.fn();
vi.mock("@/lib/pm/my-work", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pm/my-work")>()),
  getMyOpenTasks: mockOpenTasks,
}));

const service = await import("@/lib/today/plan-service");

const access = { workspaceId: "ws-1", workspaceName: "Ops", userId: "u-1", role: "member" as const };
const NOW = new Date("2026-10-21T06:00:00Z"); // 14:00 in Hong Kong
const PLANNED_AT = "2026-10-21T01:00:00.000Z";

function openTask(id: string, title: string) {
  return {
    id,
    title,
    dueDate: null,
    priority: "medium",
    estimatedHours: null,
    status: { key: "todo", label: "To do", category: "open" },
    project: { id: "p1", name: "Ops" },
    updatedAt: new Date("2026-10-20T00:00:00Z"),
    comments: [],
    snoozes: [],
  };
}

function fakeChat(reply: unknown) {
  return { modelName: "fake", complete: vi.fn(async () => JSON.stringify(reply)) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOpenTasks.mockResolvedValue([openTask("t-quote", "Send the quote"), openTask("t-contract", "Review the contract")]);
  mockPrisma.dailyPlan.findFirst.mockResolvedValue({
    availableMinutes: 120,
    note: "Meeting at 3",
    updatedAt: new Date(PLANNED_AT),
    items: [{ taskId: "t-quote", minutes: 60, reason: "Due first", batch: 1, plannedAt: PLANNED_AT }],
  });
  mockPrisma.task.findMany.mockResolvedValue([]);
});

describe("the next batch", () => {
  it("plans only tasks not already in today's plan, and adds them after it", async () => {
    const chat = fakeChat({ summary: "Then the contract.", items: [{ task: "T1", minutes: 45, reason: "Next up" }] });

    await service.planMyDay(access, { availableHours: 1, append: true }, { chat, now: NOW });

    const prompt = JSON.stringify(chat.complete.mock.calls[0]);
    expect(prompt).toContain("Review the contract");
    expect(prompt).not.toContain("Send the quote");

    const saved = mockPrisma.dailyPlan.upsert.mock.calls[0][0].update;
    expect(saved.items).toEqual([
      { taskId: "t-quote", minutes: 60, reason: "Due first", batch: 1, plannedAt: PLANNED_AT },
      { taskId: "t-contract", minutes: 45, reason: "Next up", batch: 2, plannedAt: NOW.toISOString() },
    ]);
    // The day's hours add up, and the earlier note is kept when no new one is given.
    expect(saved.availableMinutes).toBe(180);
    expect(saved.note).toBe("Meeting at 3");
  });

  it("says so when every open task is already planned", async () => {
    mockOpenTasks.mockResolvedValue([openTask("t-quote", "Send the quote")]);

    await expect(
      service.planMyDay(access, { availableHours: 1, append: true }, { chat: fakeChat({}), now: NOW }),
    ).rejects.toMatchObject({ code: "nothing_left" });
  });

  it("replaces the plan when re-planning, from every open task", async () => {
    const chat = fakeChat({ summary: "Quote first.", items: [{ task: "T1", minutes: 60, reason: "Due" }] });

    await service.planMyDay(access, { availableHours: 2 }, { chat, now: NOW });

    // Every open task is a candidate again; the only plan read is the read-back.
    const prompt = JSON.stringify(chat.complete.mock.calls[0]);
    expect(prompt).toContain("Send the quote");
    expect(prompt).toContain("Review the contract");
    expect(mockPrisma.dailyPlan.findFirst).toHaveBeenCalledTimes(1);
    const saved = mockPrisma.dailyPlan.upsert.mock.calls[0][0].update;
    expect(saved.items).toHaveLength(1);
    expect(saved.items[0]).toMatchObject({ batch: 1 });
    expect(saved.availableMinutes).toBe(120);
  });
});

describe("getDayPlan", () => {
  it("marks each item from its task as it is now", async () => {
    mockPrisma.dailyPlan.findFirst.mockResolvedValue({
      availableMinutes: 180,
      note: null,
      summary: "",
      updatedAt: new Date(PLANNED_AT),
      items: [
        { taskId: "t-done", minutes: 30, reason: "", batch: 1, plannedAt: PLANNED_AT },
        { taskId: "t-noted", minutes: 30, reason: "", batch: 1, plannedAt: PLANNED_AT },
        { taskId: "t-waiting", minutes: 30, reason: "", batch: 1, plannedAt: PLANNED_AT },
        { taskId: "t-old", minutes: 30, reason: "" },
      ],
    });
    const task = (id: string, category: string, updatedAt: string, noteAt: string | null) => ({
      id,
      title: id,
      projectId: "p1",
      project: { name: "Ops" },
      status: { category },
      updatedAt: new Date(updatedAt),
      comments: noteAt ? [{ createdAt: new Date(noteAt) }] : [],
    });
    mockPrisma.task.findMany.mockResolvedValue([
      task("t-done", "done", "2026-10-21T02:00:00Z", null),
      task("t-noted", "open", "2026-10-20T00:00:00Z", "2026-10-21T03:00:00Z"),
      task("t-waiting", "open", "2026-10-20T00:00:00Z", null),
      task("t-old", "open", "2026-10-20T00:00:00Z", null),
    ]);

    const plan = await service.getDayPlan(access, new Date("2026-10-21T00:00:00Z"));

    expect(plan?.items.map((item) => [item.taskId, item.state, item.batch])).toEqual([
      ["t-done", "done", 1],
      ["t-noted", "updated", 1],
      ["t-waiting", "pending", 1],
      // A plan from before items were stamped counts from when it was saved.
      ["t-old", "pending", 1],
    ]);
  });
});
