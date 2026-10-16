import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The shared write path behind the task routes and Capture's Apply. These pin
 * the behaviour the routes had before the extraction: scoped lookups, the
 * date-order rule against the stored row, and completion timestamps that move
 * only on a status transition.
 */

const mockPrisma = {
  task: { findFirst: vi.fn(), create: vi.fn() },
  projectTaskStatus: { findFirst: vi.fn() },
  taskComment: { create: vi.fn() },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/pm/task-relations", () => ({
  resolveTaskRelations: vi.fn(async () => ({
    ok: true,
    value: { documentIds: undefined, citations: [], requirementIds: [] },
  })),
}));

const write = await import("@/lib/pm/task-write");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("prepareTaskUpdate", () => {
  const stored = {
    id: "t1",
    projectId: "p1",
    statusId: "s-open",
    status: { category: "open" },
    startDate: new Date("2026-10-10T00:00:00Z"),
    dueDate: new Date("2026-10-20T00:00:00Z"),
  };

  it("resolves only an official task in the caller's workspace", async () => {
    mockPrisma.task.findFirst.mockResolvedValue(null);

    expect(await write.prepareTaskUpdate("ws-1", "t1", { title: "x" })).toEqual({
      ok: false,
      status: 404,
      error: "Task not found",
    });
    const where = mockPrisma.task.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: "t1", workspaceId: "ws-1" });
    expect(where.OR).toBeDefined();
  });

  it("checks a single moved date against the stored other date", async () => {
    mockPrisma.task.findFirst.mockResolvedValue(stored);

    const result = await write.prepareTaskUpdate("ws-1", "t1", {
      dueDate: new Date("2026-10-05T00:00:00Z"),
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("sets completedAt when entering done, and leaves it alone for other edits", async () => {
    mockPrisma.task.findFirst.mockResolvedValue(stored);
    mockPrisma.projectTaskStatus.findFirst.mockResolvedValue({ id: "s-done", category: "done" });

    const done = await write.prepareTaskUpdate("ws-1", "t1", { statusId: "s-done" });
    expect(done.ok && done.value.completedAt).toBeInstanceOf(Date);
    expect(mockPrisma.projectTaskStatus.findFirst.mock.calls[0][0].where).toEqual({
      id: "s-done",
      workspaceId: "ws-1",
      projectId: "p1",
    });

    const rename = await write.prepareTaskUpdate("ws-1", "t1", { title: "Renamed" });
    expect(rename.ok && rename.value.completedAt).toBeUndefined();
  });

  it("refuses a column from another project", async () => {
    mockPrisma.task.findFirst.mockResolvedValue(stored);
    mockPrisma.projectTaskStatus.findFirst.mockResolvedValue(null);

    expect(await write.prepareTaskUpdate("ws-1", "t1", { statusId: "s-foreign" })).toMatchObject({
      ok: false,
      status: 404,
    });
  });
});

describe("createTaskRecord", () => {
  it("stamps completedAt only when created straight into a done column", async () => {
    const prepared = {
      workspaceId: "ws-1",
      projectId: "p1",
      input: {
        title: "Done already",
        priority: "medium" as const,
        description: undefined,
        startDate: undefined,
        dueDate: undefined,
      },
      status: { id: "s-done", category: "done" as const },
      relations: { citations: [], requirementIds: [] },
    };
    const now = new Date("2026-10-16T02:00:00Z");

    await write.createTaskRecord(mockPrisma as never, prepared, "u-1", now);
    expect(mockPrisma.task.create.mock.calls[0][0].data).toMatchObject({
      workspaceId: "ws-1",
      projectId: "p1",
      statusId: "s-done",
      completedAt: now,
    });

    await write.createTaskRecord(
      mockPrisma as never,
      { ...prepared, status: { id: "s-open", category: "open" as const } },
      "u-1",
      now,
    );
    expect(mockPrisma.task.create.mock.calls[1][0].data.completedAt).toBeNull();
  });
});

describe("createTaskCommentRecord", () => {
  it("writes the author it is given — the caller passes the session user", async () => {
    await write.createTaskCommentRecord(mockPrisma as never, {
      workspaceId: "ws-1",
      taskId: "t1",
      authorId: "u-1",
      body: "Done",
    });
    expect(mockPrisma.taskComment.create.mock.calls[0][0].data).toEqual({
      workspaceId: "ws-1",
      taskId: "t1",
      authorId: "u-1",
      body: "Done",
    });
  });
});
