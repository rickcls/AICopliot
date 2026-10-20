import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  project: { findFirst: vi.fn() },
  task: { findMany: vi.fn() },
  milestone: { findMany: vi.fn() },
  projectRisk: { findMany: vi.fn() },
  taskDependency: { findMany: vi.fn() },
  requirement: { findMany: vi.fn() },
  taskComment: { findMany: vi.fn() },
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const { getProjectGroundingContext, getTaskGroundingContext } = await import(
  "@/lib/rag/project-context"
);

function task(id: string, status: string = "todo") {
  return {
    id,
    title: `Task ${id}`,
    description: null,
    status,
    priority: "medium",
    startDate: null,
    dueDate: null,
    completedAt: null,
    assignee: null,
    milestone: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1", name: "Launch" });
  mockPrisma.taskComment.findMany.mockResolvedValue([]);
  mockPrisma.task.findMany.mockResolvedValue([task("1")]);
  mockPrisma.milestone.findMany.mockResolvedValue([]);
  mockPrisma.projectRisk.findMany.mockResolvedValue([]);
  mockPrisma.taskDependency.findMany.mockResolvedValue([]);
  mockPrisma.requirement.findMany.mockResolvedValue([]);
});

describe("live project grounding context", () => {
  it("scopes every record query and applies the official predicate", async () => {
    await getProjectGroundingContext("ws-1", "project-1", "task status");

    expect(mockPrisma.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "project-1", workspaceId: "ws-1" } }),
    );
    for (const model of [
      mockPrisma.task,
      mockPrisma.milestone,
      mockPrisma.projectRisk,
      mockPrisma.requirement,
    ]) {
      expect(model.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspaceId: "ws-1",
            projectId: "project-1",
            OR: [
              { source: "manual", generationStatus: "not_applicable" },
              { source: "ai_suggested", generationStatus: "approved" },
            ],
          }),
        }),
      );
    }
    expect(mockPrisma.taskDependency.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: "ws-1",
          OR: expect.any(Array),
          task: expect.objectContaining({ projectId: "project-1", OR: expect.any(Array) }),
          dependsOnTask: expect.objectContaining({
            projectId: "project-1",
            OR: expect.any(Array),
          }),
        }),
      }),
    );
  });

  it("puts exact derived health and dependency counts in the snapshot", async () => {
    mockPrisma.projectRisk.findMany.mockResolvedValue([
      {
        id: "risk-1",
        description: "Vendor risk",
        impact: "high",
        likelihood: "medium",
        mitigation: null,
        status: "open",
        milestone: null,
      },
    ]);
    mockPrisma.taskDependency.findMany.mockResolvedValue([
      {
        id: "dep-1",
        task: { id: "task-1", title: "Run UAT", status: "todo", dueDate: null },
        dependsOnTask: {
          id: "task-2",
          title: "Security review",
          status: "in_progress",
          dueDate: null,
        },
      },
    ]);

    const result = await getProjectGroundingContext(
      "ws-1",
      "project-1",
      "What is project health and dependency risk?",
      new Date("2026-08-05T08:00:00.000Z"),
    );
    const snapshot = result.sources[0];

    expect(snapshot.kind).toBe("project_snapshot");
    expect(snapshot.snapshot).toMatchObject({
      health: "amber",
      riskCount: 1,
      dependencyCount: 1,
      dependencyBlockerCount: 1,
    });
    expect(snapshot.content).toContain("Derived project health: amber");
  });

  it("caps detailed sources at 60 while retaining exact aggregate counts", async () => {
    mockPrisma.task.findMany.mockResolvedValue(
      Array.from({ length: 65 }, (_, index) => task(String(index + 1))),
    );

    const result = await getProjectGroundingContext(
      "ws-1",
      "project-1",
      "Show current task status",
    );

    expect(result.sources).toHaveLength(61);
    expect(result.partial).toBe(true);
    expect(result.totalDetailedRecords).toBe(65);
    expect(result.sources[0].snapshot).toMatchObject({
      taskCount: 65,
      detailedRecordCount: 60,
      relevantRecordCount: 65,
      partial: true,
    });
  });

  it("selects records for a question asked in Chinese", async () => {
    mockPrisma.projectRisk.findMany.mockResolvedValue([
      {
        id: "risk-1",
        description: "Vendor may miss the cut-over window",
        impact: "high",
        likelihood: "medium",
        mitigation: null,
        status: "open",
        milestone: null,
      },
    ]);
    mockPrisma.task.findMany.mockResolvedValue([
      { ...task("quote"), title: "準備 ABC 報價" },
      task("other"),
    ]);

    const risks = await getProjectGroundingContext("ws-1", "project-1", "這個專案的主要風險是甚麼？");
    expect(risks.sources.map((source) => source.kind)).toContain("risk");

    // Character pairs match a Chinese title without any spaces to split on.
    const quote = await getProjectGroundingContext("ws-1", "project-1", "報價幾時要交？");
    expect(quote.sources.slice(1).map((source) => source.title)).toEqual(["準備 ABC 報價"]);
  });

  it("lists only open work when asked what is pending, and still counts the rest", async () => {
    mockPrisma.task.findMany.mockResolvedValue([
      { ...task("open"), title: "準備報價", status: { key: "todo", label: "To do", category: "open" } },
      { ...task("done"), title: "提交月報", status: { key: "done", label: "Done", category: "done" } },
    ]);

    const result = await getProjectGroundingContext("ws-1", "project-1", "有什麼 pending task？");

    const listed = result.sources.filter((source) => source.kind === "task").map((source) => source.title);
    expect(listed).toEqual(["準備報價"]);
    expect(result.sources[0].snapshot).toMatchObject({ taskCount: 2 });
  });

  it("reads the newest notes on the tasks a progress question is about", async () => {
    mockPrisma.task.findMany.mockResolvedValue([
      { ...task("quote"), title: "準備報價", status: { key: "in_progress", label: "In progress", category: "open" } },
    ]);
    const note = (id: string, day: string, body: string) => ({
      id,
      taskId: "quote",
      body,
      createdAt: new Date(`2026-10-${day}T02:00:00Z`),
      author: { name: "Rick", email: "rick@example.com" },
    });
    mockPrisma.taskComment.findMany.mockResolvedValue([
      note("n4", "20", "初稿做好，等緊 Peter 覆價錢"),
      note("n3", "19", "開始寫初稿"),
      note("n2", "18", "收到客戶需求"),
      note("n1", "17", "最舊的一則"),
    ]);

    const result = await getProjectGroundingContext("ws-1", "project-1", "報價進度點？");

    expect(mockPrisma.taskComment.findMany.mock.calls[0][0].where).toEqual({
      workspaceId: "ws-1",
      taskId: { in: ["quote"] },
    });
    const notes = result.sources.filter((source) => source.kind === "note");
    // Three per task, newest first, each saying who wrote it and when.
    expect(notes.map((source) => source.id)).toEqual(["n4", "n3", "n2"]);
    expect(notes[0].content).toContain("Written by: Rick");
    expect(notes[0].content).toContain("Note: 初稿做好，等緊 Peter 覆價錢");
    expect(notes[0].href).toBe("/projects/project-1/tasks?task=quote");
    expect(notes[0].snapshot).toMatchObject({ author: "Rick", writtenAt: "2026-10-20T02:00:00.000Z" });
  });

  it("reads no notes for a question that is not about progress", async () => {
    await getProjectGroundingContext("ws-1", "project-1", "Who owns the task?");
    expect(mockPrisma.taskComment.findMany).not.toHaveBeenCalled();
  });

  it("always brings a task's own notes into a thread about it", async () => {
    mockPrisma.task.findMany.mockResolvedValue([
      { ...task("quote"), title: "準備報價", status: { key: "todo", label: "To do", category: "open" } },
    ]);
    mockPrisma.taskComment.findMany.mockResolvedValue([
      { id: "n1", taskId: "quote", body: "已寄出", createdAt: new Date("2026-10-20T02:00:00Z"), author: null },
    ]);

    const result = await getTaskGroundingContext("ws-1", "project-1", "quote");

    expect(result.sources.map((source) => source.kind)).toEqual(["task", "note"]);
    expect(result.sources[1].content).toContain("Written by: a former member");
  });
});
