import { beforeEach, describe, expect, it, vi } from "vitest";
import { pickStatusForMove } from "@/lib/pm/status-pick";

/**
 * Moving tasks between projects: the column follows the task's own, what
 * belongs to the old project is cleared, and what belongs to the task — its
 * documents among it — comes along untouched.
 */

const tx = {
  task: { updateMany: vi.fn(), findMany: vi.fn() },
  taskDependency: { deleteMany: vi.fn() },
  requirementLink: { deleteMany: vi.fn() },
  taskDocument: { deleteMany: vi.fn() },
  document: { updateMany: vi.fn() },
};
const mockPrisma = {
  project: { findFirst: vi.fn() },
  task: { findMany: vi.fn() },
  projectTaskStatus: { findMany: vi.fn() },
  $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("server-only", () => ({}));

const { moveTasks, MoveTaskError } = await import("@/lib/pm/task-move");

const column = (id: string, key: string, category: "open" | "blocked" | "done", position: number, isDefault = false) => ({
  id,
  key,
  category,
  position,
  isDefault,
});
const TARGET_COLUMNS = [
  column("b-backlog", "backlog", "open", 0, true),
  column("b-todo", "todo", "open", 1),
  column("b-progress", "in_progress", "open", 2),
  column("b-done", "done", "done", 3),
];

describe("pickStatusForMove", () => {
  it("keeps the same column by key", () => {
    expect(pickStatusForMove(TARGET_COLUMNS, { key: "todo", category: "open" })).toEqual({
      status: TARGET_COLUMNS[1],
      fellBack: false,
    });
  });

  it("falls to the first column of the same category, not In progress", () => {
    // Moving is not a report that work started.
    expect(pickStatusForMove(TARGET_COLUMNS, { key: "custom_review", category: "open" })?.status.id).toBe(
      "b-backlog",
    );
    expect(pickStatusForMove(TARGET_COLUMNS, { key: "shipped", category: "done" })?.status.id).toBe("b-done");
  });

  it("puts blocked work in the default column, and says so, where there is no blocked column", () => {
    expect(pickStatusForMove(TARGET_COLUMNS, { key: "blocked", category: "blocked" })).toEqual({
      status: TARGET_COLUMNS[0],
      fellBack: true,
    });
  });
});

describe("moveTasks", () => {
  const access = { workspaceId: "ws-1", userId: "u-1" };
  const task = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    projectId: "p-personal",
    milestoneId: null,
    status: { key: "todo", category: "open" },
    ...extra,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: "p-client", name: "Client A" });
    mockPrisma.projectTaskStatus.findMany.mockResolvedValue(TARGET_COLUMNS);
    tx.task.updateMany.mockResolvedValue({ count: 1 });
    tx.taskDependency.deleteMany.mockResolvedValue({ count: 1 });
    tx.requirementLink.deleteMany.mockResolvedValue({ count: 0 });
    tx.task.findMany.mockResolvedValue([{ id: "t1" }]);
  });

  it("only files into a project the person can see, and only official tasks", async () => {
    mockPrisma.task.findMany.mockResolvedValue([task("t1")]);

    await moveTasks(access, ["t1"], "p-client");

    expect(mockPrisma.project.findFirst.mock.calls[0][0].where).toEqual({
      AND: [
        { id: "p-client" },
        { workspaceId: "ws-1", OR: [{ personalOwnerId: null }, { personalOwnerId: "u-1" }] },
      ],
    });
    const taskWhere = mockPrisma.task.findMany.mock.calls[0][0].where;
    expect(taskWhere).toMatchObject({ id: { in: ["t1"] }, workspaceId: "ws-1" });
    expect(taskWhere.OR).toBeDefined();
  });

  it("refuses a hidden or unknown project, and a task that does not resolve", async () => {
    mockPrisma.project.findFirst.mockResolvedValue(null);
    mockPrisma.task.findMany.mockResolvedValue([task("t1")]);
    await expect(moveTasks(access, ["t1"], "p-hidden")).rejects.toMatchObject({ status: 404 });

    mockPrisma.project.findFirst.mockResolvedValue({ id: "p-client", name: "Client A" });
    mockPrisma.task.findMany.mockResolvedValue([]);
    await expect(moveTasks(access, ["t-elsewhere"], "p-client")).rejects.toBeInstanceOf(MoveTaskError);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("re-homes the column, clears the milestone, and moves conditionally on the old project", async () => {
    mockPrisma.task.findMany.mockResolvedValue([task("t1", { milestoneId: "m-old" })]);

    const result = await moveTasks(access, ["t1"], "p-client");

    expect(tx.task.updateMany).toHaveBeenCalledWith({
      where: { id: "t1", workspaceId: "ws-1", projectId: "p-personal" },
      data: { projectId: "p-client", statusId: "b-todo", milestoneId: null },
    });
    expect(result.cleared).toEqual({ milestones: 1, dependencies: 1, requirements: 0 });
    expect(result.project).toEqual({ id: "p-client", name: "Client A" });
  });

  it("keeps dependencies between tasks moved together and clears the ones left behind", async () => {
    mockPrisma.task.findMany.mockResolvedValue([task("parent"), task("child")]);

    await moveTasks(access, ["parent", "child"], "p-client");

    expect(tx.taskDependency.deleteMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "ws-1",
        OR: [
          { taskId: { in: ["parent", "child"] }, dependsOnTaskId: { notIn: ["parent", "child"] } },
          { dependsOnTaskId: { in: ["parent", "child"] }, taskId: { notIn: ["parent", "child"] } },
        ],
      },
    });
    expect(tx.requirementLink.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", taskId: { in: ["parent", "child"] } },
    });
  });

  it("leaves the documents filed where they are, and the task's links to them", async () => {
    mockPrisma.task.findMany.mockResolvedValue([task("t1")]);
    await moveTasks(access, ["t1"], "p-client");
    expect(tx.taskDocument.deleteMany).not.toHaveBeenCalled();
    expect(tx.document.updateMany).not.toHaveBeenCalled();
  });

  it("rolls back when another move got there first", async () => {
    mockPrisma.task.findMany.mockResolvedValue([task("t1")]);
    tx.task.updateMany.mockResolvedValue({ count: 0 });

    await expect(moveTasks(access, ["t1"], "p-client")).rejects.toMatchObject({ status: 409 });
    expect(tx.taskDependency.deleteMany).not.toHaveBeenCalled();
  });

  it("reports blocked work that landed in the default column", async () => {
    mockPrisma.task.findMany.mockResolvedValue([task("t1", { status: { key: "blocked", category: "blocked" } })]);

    const result = await moveTasks(access, ["t1"], "p-client");

    expect(tx.task.updateMany.mock.calls[0][0].data.statusId).toBe("b-backlog");
    expect(result.fellBack).toBe(1);
  });

  it("refuses a move into the project the task is already in", async () => {
    mockPrisma.task.findMany.mockResolvedValue([task("t1", { projectId: "p-client" })]);
    await expect(moveTasks(access, ["t1"], "p-client")).rejects.toMatchObject({ status: 400 });
  });
});
