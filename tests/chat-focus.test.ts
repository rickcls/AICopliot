import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  task: { findFirst: vi.fn() },
  project: { findFirst: vi.fn() },
  document: { findMany: vi.fn() },
  taskDocument: { findMany: vi.fn() },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma }));

const { answerFocusFor, resolveNewThreadScope } = await import("@/lib/chat/focus");

beforeEach(() => {
  vi.clearAllMocks();
  prisma.project.findFirst.mockResolvedValue({ id: "p1" });
});

describe("resolveNewThreadScope", () => {
  it("takes a task's project from the task, and only an official task", async () => {
    prisma.task.findFirst.mockResolvedValue({ id: "t1", projectId: "p1" });

    const result = await resolveNewThreadScope("ws-1", {
      projectId: null,
      taskId: "t1",
      documentIds: [],
    });

    expect(result).toEqual({
      ok: true,
      scope: {
        projectId: "p1",
        groundingScope: "project_combined",
        focus: "task",
        taskId: "t1",
        focusDocumentIds: [],
      },
    });
    // Scoped by workspace, and limited to official (non-draft) tasks.
    const where = prisma.task.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: "t1", workspaceId: "ws-1" });
    expect(JSON.stringify(where)).toContain("approved");
  });

  it("refuses a task from another project rather than correcting it", async () => {
    prisma.task.findFirst.mockResolvedValue({ id: "t1", projectId: "p2" });
    const result = await resolveNewThreadScope("ws-1", {
      projectId: "p1",
      taskId: "t1",
      documentIds: [],
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("does not resolve a task id from outside the workspace", async () => {
    prisma.task.findFirst.mockResolvedValue(null);
    const result = await resolveNewThreadScope("ws-1", {
      projectId: null,
      taskId: "elsewhere",
      documentIds: [],
    });
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it("refuses documents that are not all in the chosen project", async () => {
    prisma.document.findMany.mockResolvedValue([{ id: "d1" }]);
    const result = await resolveNewThreadScope("ws-1", {
      projectId: "p1",
      taskId: null,
      documentIds: ["d1", "d2"],
    });
    expect(result).toMatchObject({ ok: false, status: 404 });
    expect(prisma.document.findMany.mock.calls[0][0].where).toMatchObject({
      workspaceId: "ws-1",
      projectId: "p1",
    });
  });

  it("makes a document focus document-only", async () => {
    prisma.document.findMany.mockResolvedValue([{ id: "d1" }, { id: "d2" }]);
    const result = await resolveNewThreadScope("ws-1", {
      projectId: "p1",
      taskId: null,
      documentIds: ["d1", "d2"],
    });
    expect(result).toMatchObject({
      ok: true,
      scope: { groundingScope: "documents", focus: "documents", focusDocumentIds: ["d1", "d2"] },
    });
  });

  it("keeps the old behaviour with no focus", async () => {
    const result = await resolveNewThreadScope("ws-1", {
      projectId: "p1",
      taskId: null,
      documentIds: [],
    });
    expect(result).toMatchObject({
      ok: true,
      scope: { groundingScope: "project_combined", focus: "none" },
    });
  });
});

describe("answerFocusFor", () => {
  it("reads a task's linked documents fresh, inside its project", async () => {
    prisma.taskDocument.findMany.mockResolvedValue([{ documentId: "d1" }]);
    const focus = await answerFocusFor("ws-1", {
      projectId: "p1",
      focus: "task",
      taskId: "t1",
      focusDocumentIds: [],
    });
    expect(focus).toEqual({ kind: "task", taskId: "t1", documentIds: ["d1"] });
    expect(prisma.taskDocument.findMany.mock.calls[0][0].where).toMatchObject({
      workspaceId: "ws-1",
      taskId: "t1",
      document: { workspaceId: "ws-1", projectId: "p1" },
    });
  });

  it("has no focus for an ordinary thread", async () => {
    expect(
      await answerFocusFor("ws-1", {
        projectId: "p1",
        focus: "none",
        taskId: null,
        focusDocumentIds: [],
      }),
    ).toBeUndefined();
  });
});
