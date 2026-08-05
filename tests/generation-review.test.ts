import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => {
  const tx = {
    generationRun: { findFirst: vi.fn(), update: vi.fn() },
    milestone: { findMany: vi.fn(), updateMany: vi.fn(), groupBy: vi.fn() },
    task: { findMany: vi.fn(), updateMany: vi.fn(), groupBy: vi.fn() },
    projectRisk: { findMany: vi.fn(), updateMany: vi.fn(), groupBy: vi.fn() },
    taskDependency: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      groupBy: vi.fn(),
    },
    taskCitation: { deleteMany: vi.fn() },
    riskCitation: { deleteMany: vi.fn() },
  };
  return {
    tx,
    prisma: {
      generationRun: { findFirst: vi.fn() },
      $transaction: vi.fn(),
    },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: fakes.prisma }));
vi.mock("@/lib/generation/service", () => ({
  GenerationRequestError: class GenerationRequestError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
      this.name = "GenerationRequestError";
    }
  },
}));

import { reviewDraftProposals } from "@/lib/generation/review";

const context = {
  workspaceId: "workspace-1",
  projectId: "project-1",
  runId: "run-1",
  userId: "reviewer-1",
};

function groups(
  draft: number,
  approved: number,
  rejected: number,
) {
  return [
    ...(draft ? [{ generationStatus: "draft", _count: draft }] : []),
    ...(approved ? [{ generationStatus: "approved", _count: approved }] : []),
    ...(rejected ? [{ generationStatus: "rejected", _count: rejected }] : []),
  ];
}

function setupBase() {
  fakes.prisma.generationRun.findFirst.mockResolvedValue({
    id: "run-1",
    status: "draft",
  });
  fakes.tx.generationRun.findFirst.mockResolvedValue({ status: "draft" });
  fakes.tx.generationRun.update.mockImplementation(async ({ data }) => ({
    id: "run-1",
    ...data,
  }));
  fakes.tx.milestone.findMany.mockResolvedValue([]);
  fakes.tx.task.findMany.mockResolvedValue([]);
  fakes.tx.projectRisk.findMany.mockResolvedValue([]);
  fakes.tx.taskDependency.findMany.mockResolvedValue([]);
  fakes.tx.milestone.updateMany.mockResolvedValue({ count: 1 });
  fakes.tx.task.updateMany.mockResolvedValue({ count: 1 });
  fakes.tx.projectRisk.updateMany.mockResolvedValue({ count: 1 });
  fakes.tx.taskDependency.updateMany.mockResolvedValue({ count: 1 });
  fakes.tx.taskCitation.deleteMany.mockResolvedValue({ count: 0 });
  fakes.tx.riskCitation.deleteMany.mockResolvedValue({ count: 0 });
  fakes.tx.milestone.groupBy.mockResolvedValue([]);
  fakes.tx.task.groupBy.mockResolvedValue([]);
  fakes.tx.projectRisk.groupBy.mockResolvedValue([]);
  fakes.tx.taskDependency.groupBy.mockResolvedValue([]);
  fakes.prisma.$transaction.mockImplementation(
    async (operation: (tx: typeof fakes.tx) => unknown) => operation(fakes.tx),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setupBase();
});

describe("reviewDraftProposals", () => {
  it("returns 404 without entering a transaction when the run is outside scope", async () => {
    fakes.prisma.generationRun.findFirst.mockResolvedValue(null);
    await expect(
      reviewDraftProposals(context, "reject", [{ kind: "task", id: "task-1" }]),
    ).rejects.toMatchObject({ status: 404 });

    expect(fakes.prisma.generationRun.findFirst).toHaveBeenCalledWith({
      where: {
        id: "run-1",
        workspaceId: "workspace-1",
        projectId: "project-1",
        type: "project_plan",
      },
      select: { id: true, status: true },
    });
    expect(fakes.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("records reviewer audit fields and rejects remaining draft edges with a task", async () => {
    fakes.tx.task.findMany.mockResolvedValue([
      { id: "task-1", generationStatus: "draft", milestoneId: null },
    ]);
    fakes.tx.taskDependency.findMany.mockResolvedValue([
      {
        id: "edge-1",
        generationStatus: "draft",
        taskId: "task-1",
        dependsOnTaskId: "task-2",
      },
    ]);
    fakes.tx.task.groupBy.mockResolvedValue(groups(0, 0, 1));
    fakes.tx.taskDependency.groupBy.mockResolvedValue(groups(0, 0, 1));

    const result = await reviewDraftProposals(context, "reject", [
      { kind: "task", id: "task-1" },
    ]);

    expect(result.status).toBe("rejected");
    const taskMutation = fakes.tx.task.updateMany.mock.calls[0][0];
    expect(taskMutation.where).toMatchObject({
      id: "task-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      generationRunId: "run-1",
      generationStatus: "draft",
    });
    expect(taskMutation.data).toMatchObject({
      generationStatus: "rejected",
      reviewedById: "reviewer-1",
      reviewedAt: expect.any(Date),
    });
    expect(fakes.tx.taskDependency.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: "workspace-1",
          generationRunId: "run-1",
          generationStatus: "draft",
        }),
        data: expect.objectContaining({ reviewedById: "reviewer-1" }),
      }),
    );
  });

  it("can reject a task and its explicitly selected dependency in one batch", async () => {
    fakes.tx.task.findMany.mockResolvedValue([
      { id: "task-1", generationStatus: "draft", milestoneId: null },
      { id: "task-2", generationStatus: "draft", milestoneId: null },
    ]);
    fakes.tx.taskDependency.findMany.mockResolvedValue([
      {
        id: "edge-1",
        generationStatus: "draft",
        taskId: "task-2",
        dependsOnTaskId: "task-1",
      },
    ]);
    fakes.tx.task.groupBy.mockResolvedValue(groups(1, 0, 1));
    fakes.tx.taskDependency.groupBy.mockResolvedValue(groups(0, 0, 1));
    let edgeStatus: "draft" | "rejected" = "draft";
    fakes.tx.taskDependency.updateMany.mockImplementation(async ({ where, data }) => {
      if (edgeStatus !== "draft" || where.generationStatus !== "draft") {
        return { count: 0 };
      }
      edgeStatus = data.generationStatus;
      return { count: 1 };
    });

    await expect(
      reviewDraftProposals(context, "reject", [
        { kind: "task", id: "task-1" },
        { kind: "dependency", id: "edge-1" },
      ]),
    ).resolves.toMatchObject({ status: "draft" });

    expect(edgeStatus).toBe("rejected");

    expect(fakes.tx.taskDependency.updateMany.mock.calls[0][0].where).toMatchObject({
      id: "edge-1",
      generationStatus: "draft",
    });
  });

  it("atomically blocks dependency approval unless both tasks are approved or selected", async () => {
    fakes.tx.task.findMany.mockResolvedValue([
      { id: "task-1", generationStatus: "draft", milestoneId: null },
      { id: "task-2", generationStatus: "draft", milestoneId: null },
    ]);
    fakes.tx.taskDependency.findMany.mockResolvedValue([
      {
        id: "edge-1",
        generationStatus: "draft",
        taskId: "task-2",
        dependsOnTaskId: "task-1",
      },
    ]);

    await expect(
      reviewDraftProposals(context, "approve", [
        { kind: "dependency", id: "edge-1" },
      ]),
    ).rejects.toMatchObject({ status: 409 });
    expect(fakes.tx.taskDependency.updateMany).not.toHaveBeenCalled();
    expect(fakes.tx.generationRun.update).not.toHaveBeenCalled();
  });

  it("blocks a linked task unless its milestone is approved or selected", async () => {
    fakes.tx.milestone.findMany.mockResolvedValue([
      { id: "milestone-1", generationStatus: "draft" },
    ]);
    fakes.tx.task.findMany.mockResolvedValue([
      {
        id: "task-1",
        generationStatus: "draft",
        milestoneId: "milestone-1",
      },
    ]);

    await expect(
      reviewDraftProposals(context, "approve", [
        { kind: "task", id: "task-1" },
      ]),
    ).rejects.toMatchObject({ status: 409 });
    expect(fakes.tx.task.updateMany).not.toHaveBeenCalled();
  });

  it("approves prerequisites together and sets approvedAt only when all are approved", async () => {
    fakes.tx.milestone.findMany.mockResolvedValue([
      { id: "milestone-1", generationStatus: "draft" },
    ]);
    fakes.tx.task.findMany.mockResolvedValue([
      {
        id: "task-1",
        generationStatus: "draft",
        milestoneId: "milestone-1",
      },
      { id: "task-2", generationStatus: "draft", milestoneId: null },
    ]);
    fakes.tx.taskDependency.findMany.mockResolvedValue([
      {
        id: "edge-1",
        generationStatus: "draft",
        taskId: "task-2",
        dependsOnTaskId: "task-1",
      },
    ]);
    fakes.tx.milestone.groupBy.mockResolvedValue(groups(0, 1, 0));
    fakes.tx.task.groupBy.mockResolvedValue(groups(0, 2, 0));
    fakes.tx.taskDependency.groupBy.mockResolvedValue(groups(0, 1, 0));

    const result = await reviewDraftProposals(context, "approve", [
      { kind: "milestone", id: "milestone-1" },
      { kind: "task", id: "task-1" },
      { kind: "task", id: "task-2" },
      { kind: "dependency", id: "edge-1" },
    ]);

    expect(result.status).toBe("approved");
    expect(result.approvedAt).toEqual(expect.any(Date));
    expect(fakes.tx.milestone.updateMany).toHaveBeenCalledTimes(1);
    expect(fakes.tx.task.updateMany).toHaveBeenCalledTimes(2);
    expect(fakes.tx.taskDependency.updateMany).toHaveBeenCalledTimes(1);
    expect(fakes.prisma.$transaction.mock.calls[0][1]).toMatchObject({
      isolationLevel: "Serializable",
    });
  });

  it("derives partially approved and leaves approvedAt empty after mixed final review", async () => {
    fakes.tx.task.findMany.mockResolvedValue([
      { id: "task-1", generationStatus: "draft", milestoneId: null },
      { id: "task-2", generationStatus: "approved", milestoneId: null },
    ]);
    fakes.tx.task.groupBy.mockResolvedValue(groups(0, 1, 1));

    const result = await reviewDraftProposals(context, "reject", [
      { kind: "task", id: "task-1" },
    ]);

    expect(result).toMatchObject({
      status: "partially_approved",
      approvedAt: null,
    });
  });

  it("keeps the run draft while any proposal remains unreviewed", async () => {
    fakes.tx.task.findMany.mockResolvedValue([
      { id: "task-1", generationStatus: "draft", milestoneId: null },
      { id: "task-2", generationStatus: "draft", milestoneId: null },
    ]);
    fakes.tx.task.groupBy.mockResolvedValue(groups(1, 1, 0));

    const result = await reviewDraftProposals(context, "approve", [
      { kind: "task", id: "task-1" },
    ]);
    expect(result).toMatchObject({ status: "draft", approvedAt: null });
  });
});
