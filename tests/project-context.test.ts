import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  project: { findFirst: vi.fn() },
  task: { findMany: vi.fn() },
  milestone: { findMany: vi.fn() },
  projectRisk: { findMany: vi.fn() },
  taskDependency: { findMany: vi.fn() },
  requirement: { findMany: vi.fn() },
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const { getProjectGroundingContext } = await import(
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
});
