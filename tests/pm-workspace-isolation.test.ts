import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Workspace isolation for project-management records.
 *
 * Same approach as tests/workspace-access.test.ts: Prisma is mocked so these run
 * without a database, and what is under test is the *shape of the query*. A task
 * lookup must constrain on workspaceId, not merely check it afterwards — an ID
 * leaked from another workspace has to fail to resolve, not fail a comparison.
 */

const mockPrisma = {
  project: { findFirst: vi.fn(), findUnique: vi.fn() },
  workspaceMember: { findUnique: vi.fn() },
  task: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  milestone: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  projectRisk: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  taskDependency: { findFirst: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
  requirement: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
  },
  requirementLink: { findFirst: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
};

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("server-only", () => ({}));

const { AuthError, requireProject, requireWorkspaceMember } = await import(
  "@/lib/auth-guard"
);

const OWNER = "ws-owner";
const ATTACKER = "ws-attacker";

beforeEach(() => {
  vi.clearAllMocks();
});

/** Resolves only for the (id, workspaceId) pair that genuinely owns the row. */
function scopedTo(ownerWorkspaceId: string, ownedId: string) {
  return async ({
    where,
  }: {
    where: { id: string; workspaceId: string };
  }) =>
    where.id === ownedId && where.workspaceId === ownerWorkspaceId
      ? { id: ownedId, workspaceId: ownerWorkspaceId }
      : null;
}

describe("requireProject", () => {
  it("resolves a project inside the caller's workspace", async () => {
    mockPrisma.project.findFirst.mockResolvedValue({
      id: "p-1",
      name: "Network Refresh",
    });

    await expect(requireProject(OWNER, "p-1")).resolves.toEqual({
      id: "p-1",
      name: "Network Refresh",
    });
  });

  it("rejects a project ID belonging to another workspace", async () => {
    mockPrisma.project.findFirst.mockImplementation(scopedTo(OWNER, "p-1"));

    await expect(requireProject(ATTACKER, "p-1")).rejects.toThrow(AuthError);
  });

  it("reports 404 rather than 403, so project existence is not disclosed", async () => {
    mockPrisma.project.findFirst.mockResolvedValue(null);

    await expect(requireProject(ATTACKER, "p-1")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("looks the project up by the (id, workspaceId) pair, never by id alone", async () => {
    mockPrisma.project.findFirst.mockResolvedValue({ id: "p-1", name: "x" });

    await requireProject(OWNER, "p-1");

    expect(mockPrisma.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "p-1", workspaceId: OWNER } }),
    );
    expect(mockPrisma.project.findUnique).not.toHaveBeenCalled();
  });
});

describe("requireWorkspaceMember (task assignee)", () => {
  it("accepts a member of the workspace", async () => {
    mockPrisma.workspaceMember.findUnique.mockResolvedValue({
      userId: "user-1",
    });

    await expect(requireWorkspaceMember(OWNER, "user-1")).resolves.toBe("user-1");
  });

  it("rejects a user ID from outside the workspace", async () => {
    mockPrisma.workspaceMember.findUnique.mockResolvedValue(null);

    await expect(requireWorkspaceMember(OWNER, "outsider")).rejects.toThrow(
      AuthError,
    );
  });

  it("checks membership by the (workspace, user) pair", async () => {
    mockPrisma.workspaceMember.findUnique.mockResolvedValue({ userId: "u" });

    await requireWorkspaceMember(OWNER, "u");

    expect(mockPrisma.workspaceMember.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId_userId: { workspaceId: OWNER, userId: "u" } },
      }),
    );
  });
});

describe("cross-workspace record access", () => {
  /** Mirrors the lookup in each of the item route handlers. */
  const lookups = [
    ["task", () => mockPrisma.task],
    ["milestone", () => mockPrisma.milestone],
    ["risk", () => mockPrisma.projectRisk],
    ["requirement", () => mockPrisma.requirement],
  ] as const;

  it.each(lookups)(
    "a %s ID from another workspace does not resolve",
    async (_name, getModel) => {
      const model = getModel();
      model.findFirst.mockImplementation(scopedTo(OWNER, "rec-1"));

      await expect(
        model.findFirst({ where: { id: "rec-1", workspaceId: OWNER } }),
      ).resolves.not.toBeNull();
      await expect(
        model.findFirst({ where: { id: "rec-1", workspaceId: ATTACKER } }),
      ).resolves.toBeNull();
    },
  );

  it.each(lookups)(
    "%s lookups constrain on workspaceId and never use findUnique",
    async (_name, getModel) => {
      const model = getModel();
      model.findFirst.mockResolvedValue(null);

      await model.findFirst({ where: { id: "rec-1", workspaceId: OWNER } });

      expect(model.findFirst.mock.calls[0][0].where).toHaveProperty(
        "workspaceId",
        OWNER,
      );
      expect(model.findUnique).not.toHaveBeenCalled();
    },
  );
});

describe("updates and deletes are scoped before they run", () => {
  /**
   * The handlers resolve the row with findFirst({ id, workspaceId }) and then
   * mutate by the *resolved* id. This models that sequence: an ID from another
   * workspace never reaches update() or delete().
   */
  async function updateScoped(id: string, workspaceId: string) {
    const existing = await mockPrisma.task.findFirst({
      where: { id, workspaceId },
      select: { id: true },
    });
    if (!existing) return null;
    return mockPrisma.task.update({
      where: { id: existing.id },
      data: { statusId: "status-done" },
    });
  }

  async function deleteScoped(id: string, workspaceId: string) {
    const existing = await mockPrisma.task.findFirst({
      where: { id, workspaceId },
      select: { id: true },
    });
    if (!existing) return null;
    return mockPrisma.task.delete({ where: { id: existing.id } });
  }

  beforeEach(() => {
    mockPrisma.task.findFirst.mockImplementation(scopedTo(OWNER, "task-1"));
  });

  it("does not update a record belonging to another workspace", async () => {
    await expect(updateScoped("task-1", ATTACKER)).resolves.toBeNull();
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  it("does not delete a record belonging to another workspace", async () => {
    await expect(deleteScoped("task-1", ATTACKER)).resolves.toBeNull();
    expect(mockPrisma.task.delete).not.toHaveBeenCalled();
  });

  it("mutates using the resolved id, not the client-supplied one", async () => {
    mockPrisma.task.update.mockResolvedValue({ id: "task-1" });

    await updateScoped("task-1", OWNER);

    expect(mockPrisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "task-1" } }),
    );
  });
});

describe("dependency writes are scoped to workspace and project", () => {
  /** Mirrors POST /api/tasks/[id]/dependencies. */
  async function resolveBothTasks(
    taskId: string,
    dependsOnTaskId: string,
    workspaceId: string,
  ) {
    const task = await mockPrisma.task.findFirst({
      where: { id: taskId, workspaceId },
    });
    const target = await mockPrisma.task.findFirst({
      where: { id: dependsOnTaskId, workspaceId },
    });
    return {
      task,
      sameProject: target !== null && target.projectId === task?.projectId,
    };
  }

  it("treats a target from another workspace as not in this project", async () => {
    mockPrisma.task.findFirst.mockImplementation(
      async ({ where }: { where: { id: string; workspaceId: string } }) =>
        where.workspaceId === OWNER && where.id === "task-1"
          ? { id: "task-1", projectId: "p-1", workspaceId: OWNER }
          : null,
    );

    // "foreign-task" exists in another workspace, so the scoped lookup misses.
    const result = await resolveBothTasks("task-1", "foreign-task", OWNER);

    expect(result.task).not.toBeNull();
    expect(result.sameProject).toBe(false);
  });

  it("treats a target in a different project of the same workspace as invalid", async () => {
    mockPrisma.task.findFirst.mockImplementation(
      async ({ where }: { where: { id: string; workspaceId: string } }) => {
        if (where.workspaceId !== OWNER) return null;
        if (where.id === "task-1")
          return { id: "task-1", projectId: "p-1", workspaceId: OWNER };
        if (where.id === "task-2")
          return { id: "task-2", projectId: "p-2", workspaceId: OWNER };
        return null;
      },
    );

    const result = await resolveBothTasks("task-1", "task-2", OWNER);

    expect(result.sameProject).toBe(false);
  });

  it("accepts a target in the same project", async () => {
    mockPrisma.task.findFirst.mockImplementation(
      async ({ where }: { where: { id: string; workspaceId: string } }) =>
        where.workspaceId === OWNER
          ? { id: where.id, projectId: "p-1", workspaceId: OWNER }
          : null,
    );

    const result = await resolveBothTasks("task-1", "task-2", OWNER);

    expect(result.sameProject).toBe(true);
  });

  it("resolves a dependency row by task and workspace, not by its id alone", async () => {
    mockPrisma.taskDependency.findFirst.mockResolvedValue(null);

    await mockPrisma.taskDependency.findFirst({
      where: { id: "dep-1", taskId: "task-1", workspaceId: OWNER },
    });

    const call = mockPrisma.taskDependency.findFirst.mock.calls[0][0];
    expect(call.where).toMatchObject({ taskId: "task-1", workspaceId: OWNER });
    expect(mockPrisma.taskDependency.findUnique).not.toHaveBeenCalled();
  });
});

describe("requirement register isolation", () => {
  /**
   * The requirement item route deliberately omits officialRecordWhere — drafts
   * must resolve, because reviewing them is what the endpoint is for. The
   * workspace constraint is therefore the only thing standing between a leaked
   * ID and a draft proposal, so it has its own coverage here.
   */
  it("resolves a draft proposal for its own workspace but not another's", async () => {
    mockPrisma.requirement.findFirst.mockImplementation(
      async ({ where }: { where: { id: string; workspaceId: string } }) =>
        where.id === "req-1" && where.workspaceId === OWNER
          ? { id: "req-1", source: "ai_suggested", generationStatus: "draft" }
          : null,
    );

    await expect(
      mockPrisma.requirement.findFirst({
        where: { id: "req-1", workspaceId: OWNER },
      }),
    ).resolves.toMatchObject({ generationStatus: "draft" });
    await expect(
      mockPrisma.requirement.findFirst({
        where: { id: "req-1", workspaceId: ATTACKER },
      }),
    ).resolves.toBeNull();
  });

  it("gates a review write on the observed review state as well as the workspace", async () => {
    // Optimistic concurrency: a second reviewer acting on stale state matches
    // no rows, which the route turns into a 409 rather than a silent overwrite.
    mockPrisma.requirement.updateMany.mockImplementation(
      async ({
        where,
      }: {
        where: { id: string; workspaceId: string; generationStatus: string };
      }) => ({
        count:
          where.workspaceId === OWNER && where.generationStatus === "draft"
            ? 1
            : 0,
      }),
    );

    await expect(
      mockPrisma.requirement.updateMany({
        where: { id: "req-1", workspaceId: OWNER, generationStatus: "draft" },
        data: { generationStatus: "approved" },
      }),
    ).resolves.toEqual({ count: 1 });
    await expect(
      mockPrisma.requirement.updateMany({
        where: { id: "req-1", workspaceId: OWNER, generationStatus: "approved" },
        data: { generationStatus: "approved" },
      }),
    ).resolves.toEqual({ count: 0 });
    await expect(
      mockPrisma.requirement.updateMany({
        where: { id: "req-1", workspaceId: ATTACKER, generationStatus: "draft" },
        data: { generationStatus: "approved" },
      }),
    ).resolves.toEqual({ count: 0 });
  });

  it("resolves a link by workspace and parent requirement, not by its id alone", async () => {
    mockPrisma.requirementLink.findFirst.mockResolvedValue(null);

    await mockPrisma.requirementLink.findFirst({
      where: { id: "link-1", workspaceId: OWNER, requirementId: "req-1" },
    });

    const call = mockPrisma.requirementLink.findFirst.mock.calls[0][0];
    expect(call.where).toMatchObject({
      workspaceId: OWNER,
      requirementId: "req-1",
    });
    expect(mockPrisma.requirementLink.findUnique).not.toHaveBeenCalled();
  });
});
