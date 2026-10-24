import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = {
  task: { update: vi.fn() },
  taskSnooze: { deleteMany: vi.fn() },
};
const mockPrisma = {
  task: { findFirst: vi.fn() },
  projectTaskStatus: { findMany: vi.fn() },
  taskSnooze: { upsert: vi.fn() },
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-guard")>()),
  getUserPreferences: vi.fn(async () => ({ locale: "zh-Hant", timeZone: "Asia/Hong_Kong" })),
}));
const writes = {
  prepareTaskUpdate: vi.fn(),
  updateTaskRecord: vi.fn(),
  createTaskCommentRecord: vi.fn(),
};
vi.mock("@/lib/pm/task-write", () => writes);

const { checkIn } = await import("@/lib/today/check-in");

const access = { workspaceId: "ws-1", workspaceName: "Ops", userId: "u-1", role: "member" as const };
const NOW = new Date("2026-10-16T02:00:00Z");
const statuses = [
  { id: "s-backlog", key: "backlog", category: "open", position: 0 },
  { id: "s-progress", key: "in_progress", category: "open", position: 2 },
  { id: "s-done", key: "done", category: "done", position: 4 },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.projectTaskStatus.findMany.mockResolvedValue(statuses);
  writes.prepareTaskUpdate.mockResolvedValue({ ok: true, value: { prepared: true } });
});

function taskIn(category: string) {
  mockPrisma.task.findFirst.mockResolvedValue({
    id: "t1",
    projectId: "p1",
    status: { id: `s-was-${category}`, category },
  });
}

describe("checkIn", () => {
  it("resolves only an official task in the caller's workspace", async () => {
    mockPrisma.task.findFirst.mockResolvedValue(null);
    await expect(checkIn(access, "t-elsewhere", { action: "done" }, NOW)).rejects.toMatchObject({ status: 404 });
    expect(mockPrisma.task.findFirst.mock.calls[0][0].where).toMatchObject({
      id: "t-elsewhere",
      workspaceId: "ws-1",
    });
  });

  it("moves a finished task to the done column through task-write, with the note as the person's comment", async () => {
    taskIn("open");
    await checkIn(access, "t1", { action: "done", note: "Sent to ABC" }, NOW);

    expect(writes.prepareTaskUpdate).toHaveBeenCalledWith("ws-1", "t1", { statusId: "s-done" });
    expect(writes.updateTaskRecord.mock.calls[0][0]).toBe(tx);
    expect(writes.createTaskCommentRecord.mock.calls[0][1]).toEqual({
      workspaceId: "ws-1",
      taskId: "t1",
      authorId: "u-1",
      body: "Sent to ABC",
    });
    expect(tx.task.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { checkedInAt: NOW } });
  });

  it("says which column a moved task came from, so a mistaken tick can be undone", async () => {
    taskIn("open");
    const result = await checkIn(access, "t1", { action: "done" }, NOW);
    expect(result.previousStatusId).toBe("s-was-open");
  });

  it("has no column to restore when the answer did not move the task", async () => {
    taskIn("open");
    expect((await checkIn(access, "t1", { action: "progress" }, NOW)).previousStatusId).toBeNull();
    expect((await checkIn(access, "t1", { action: "snooze" }, NOW)).previousStatusId).toBeNull();
  });

  it("records 'still working' on an open task without moving it", async () => {
    taskIn("open");
    await checkIn(access, "t1", { action: "progress" }, NOW);

    expect(writes.prepareTaskUpdate).not.toHaveBeenCalled();
    expect(tx.task.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { checkedInAt: NOW } });
    expect(tx.taskSnooze.deleteMany).toHaveBeenCalledWith({ where: { userId: "u-1", taskId: "t1" } });
  });

  it("moves a blocked task back to In progress when work resumes", async () => {
    taskIn("blocked");
    await checkIn(access, "t1", { action: "progress" }, NOW);
    expect(writes.prepareTaskUpdate).toHaveBeenCalledWith("ws-1", "t1", { statusId: "s-progress" });
  });

  it("refuses 'blocked' in a project with no blocked column", async () => {
    taskIn("open");
    await expect(checkIn(access, "t1", { action: "blocked" }, NOW)).rejects.toMatchObject({ status: 409 });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("snoozes for this person only, without touching the task", async () => {
    taskIn("open");
    const result = await checkIn(access, "t1", { action: "snooze" }, NOW);

    const call = mockPrisma.taskSnooze.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ userId_taskId: { userId: "u-1", taskId: "t1" } });
    // Three days after the person's own day (16 Oct in Hong Kong).
    expect(call.create.until.toISOString()).toBe("2026-10-19T00:00:00.000Z");
    expect(result.until?.toISOString()).toBe("2026-10-19T00:00:00.000Z");
    expect(tx.task.update).not.toHaveBeenCalled();
  });
});
