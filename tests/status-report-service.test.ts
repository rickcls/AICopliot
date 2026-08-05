import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  project: { findFirst: vi.fn() },
  task: { findMany: vi.fn() },
  milestone: { findMany: vi.fn() },
  projectRisk: { findMany: vi.fn() },
  taskDependency: { findMany: vi.fn() },
  generationRun: {
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/providers", () => ({
  getChatProvider: () => {
    throw new Error("provider is not configured");
  },
}));

const {
  generateStatusReport,
  getStatusReport,
  listStatusReports,
  StatusReportRequestError,
} = await import("@/lib/reports/service");

const INPUT = { workspaceId: "ws-1", projectId: "project-1", userId: "user-1" };

function configureRows({ withTask = true }: { withTask?: boolean } = {}) {
  mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1", name: "Launch" });
  mockPrisma.task.findMany.mockResolvedValue(
    withTask
      ? [
          {
            id: "real-task-id",
            title: "Prepare launch",
            description: null,
            status: "todo",
            priority: "medium",
            dueDate: null,
            completedAt: null,
            assignee: null,
            milestone: null,
          },
        ]
      : [],
  );
  mockPrisma.milestone.findMany.mockResolvedValue([]);
  mockPrisma.projectRisk.findMany.mockResolvedValue([]);
  mockPrisma.taskDependency.findMany.mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  configureRows();
  mockPrisma.generationRun.create.mockResolvedValue({ id: "run-1" });
  mockPrisma.generationRun.update.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: "run-1",
      projectId: "project-1",
      model: (data.model as string | undefined) ?? "fake-chat",
      promptVersion: "status-report-v1",
      status: (data.status as string | undefined) ?? "processing",
      errorMessage: (data.errorMessage as string | null | undefined) ?? null,
      latencyMs: (data.latencyMs as number | null | undefined) ?? null,
      validatedOutput: data.validatedOutput ?? null,
      createdAt: new Date("2026-08-05T08:00:00.000Z"),
    }),
  );
});

describe("status report generation audit", () => {
  it("rejects empty projects before constructing or calling a model", async () => {
    configureRows({ withTask: false });
    const chat = { modelName: "fake-chat", complete: vi.fn() };

    await expect(generateStatusReport(INPUT, { chat })).rejects.toMatchObject({
      status: 422,
    });
    expect(chat.complete).not.toHaveBeenCalled();
    expect(mockPrisma.generationRun.create).not.toHaveBeenCalled();
  });

  it("creates a processing run before the provider is initialized and audits failure", async () => {
    await expect(generateStatusReport(INPUT)).rejects.toBeInstanceOf(
      StatusReportRequestError,
    );

    expect(mockPrisma.generationRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: "ws-1",
          projectId: "project-1",
          type: "status_report",
          model: "pending",
          status: "processing",
        }),
      }),
    );
    expect(mockPrisma.generationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-1" },
        data: expect.objectContaining({
          status: "failed",
          errorMessage: expect.stringContaining("not configured"),
        }),
      }),
    );
  });

  it("records ordinary completion failures as 502 failed runs", async () => {
    const chat = {
      modelName: "fake-chat",
      complete: vi.fn(async () => {
        throw new Error("upstream timeout");
      }),
    };

    await expect(generateStatusReport(INPUT, { chat })).rejects.toMatchObject({
      status: 502,
    });
    expect(mockPrisma.generationRun.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          errorMessage: expect.stringContaining("provider is unavailable"),
        }),
      }),
    );
  });

  it("allows one JSON repair then saves an auditable failed run", async () => {
    const chat = {
      modelName: "fake-chat",
      complete: vi.fn(async () => "not-json"),
    };

    await expect(generateStatusReport(INPUT, { chat })).rejects.toMatchObject({
      status: 502,
    });
    expect(chat.complete).toHaveBeenCalledTimes(2);
    expect(mockPrisma.generationRun.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rawOutput: JSON.stringify({ attempts: ["not-json", "not-json"] }),
          status: "failed",
        }),
      }),
    );
  });

  it("saves a snapshot-cited narrative and never sends record IDs to the model", async () => {
    const chat = {
      modelName: "fake-chat",
      complete: vi.fn(
        async (
          _messages: Array<{
            role: "system" | "user" | "assistant";
            content: string;
          }>,
        ) =>
          JSON.stringify({
            answer: "Project health is green, with no blockers or overdue items.",
            confidence: "high",
            insufficientContext: false,
            citations: [{ sourceId: "P1", quote: "Derived health: green" }],
          }),
      ),
    };

    const result = await generateStatusReport(INPUT, {
      chat,
      now: new Date("2026-08-05T08:00:00.000Z"),
    });

    expect(result.status).toBe("draft");
    expect(result.report?.health).toBe("green");
    expect(result.report?.citations[0]).not.toHaveProperty("recordId");
    const prompt = chat.complete.mock.calls[0][0]
      .map((message: { content: string }) => message.content)
      .join("\n");
    expect(prompt).not.toContain("real-task-id");
    expect(prompt).not.toContain("project-1");
    expect(mockPrisma.generationRun.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "draft" }),
      }),
    );
  });

  it("requires a detailed citation when the narrative has reportable blockers", async () => {
    mockPrisma.task.findMany.mockResolvedValue([
      {
        id: "blocked-task-id",
        title: "Prepare launch",
        description: null,
        status: "blocked",
        priority: "high",
        dueDate: null,
        completedAt: null,
        assignee: null,
        milestone: null,
      },
    ]);
    const chat = {
      modelName: "fake-chat",
      complete: vi.fn(async () =>
        JSON.stringify({
          answer: "Project health is red because work is blocked.",
          confidence: "high",
          insufficientContext: false,
          citations: [{ sourceId: "P1", quote: "Derived health: red" }],
        }),
      ),
    };

    await expect(generateStatusReport(INPUT, { chat })).rejects.toMatchObject({
      status: 502,
    });
    expect(mockPrisma.generationRun.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
  });
});

describe("status report workspace isolation", () => {
  it("resolves a single report only through its workspace and type", async () => {
    mockPrisma.generationRun.findFirst.mockResolvedValue(null);

    await expect(getStatusReport("ws-attacker", "report-1")).resolves.toBeNull();
    expect(mockPrisma.generationRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "report-1",
          workspaceId: "ws-attacker",
          type: "status_report",
        },
      }),
    );
  });

  it("scopes report history by workspace, project, and report type", async () => {
    mockPrisma.generationRun.findMany.mockResolvedValue([]);

    await expect(listStatusReports("ws-1", "project-1")).resolves.toEqual([]);
    expect(mockPrisma.generationRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: "ws-1",
          projectId: "project-1",
          type: "status_report",
        },
      }),
    );
  });
});
