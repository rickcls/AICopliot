import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  capture: { findMany: vi.fn() },
  task: { findFirst: vi.fn() },
  documentChunk: { findMany: vi.fn() },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ RAG_MIN_SCORE: 0.25 }) }));
const mockMyTasks = vi.fn();
vi.mock("@/lib/pm/my-work", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pm/my-work")>()),
  getMyOpenTasks: mockMyTasks,
}));
const mockDraft = vi.fn();
vi.mock("@/lib/email/service", () => ({ draftEmail: mockDraft }));
vi.mock("@/lib/rag/retrieve", () => ({ retrieveChunks: vi.fn(async () => []) }));

const { runTool } = await import("@/lib/assistant/tools");
const { SourceRegistry } = await import("@/lib/assistant/protocol");

const access = {
  workspaceId: "ws-1",
  workspaceName: "Ops",
  userId: "u-1",
  role: "member" as const,
  user: { id: "u-1", email: "r@example.com", name: "R" },
};
const today = new Date("2026-10-16T00:00:00Z");

function context() {
  return { access, registry: new SourceRegistry(), today, draftIds: [] as string[] };
}

function task(id: string, due: string | null, category: "open" | "blocked" = "open") {
  return {
    id,
    title: `Task ${id}`,
    dueDate: due ? new Date(`${due}T00:00:00Z`) : null,
    priority: "medium",
    estimatedHours: null,
    updatedAt: new Date("2026-10-15T00:00:00Z"),
    status: { key: "todo", label: "To do", category },
    project: { id: "p1", name: "Ops" },
    comments: [],
    snoozes: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assistant tools", () => {
  it("searches only the caller's own notes", async () => {
    mockPrisma.capture.findMany.mockResolvedValue([
      { id: "cap-1", body: "Peter said the contract needs legal review", localDate: today },
    ]);
    const ctx = context();
    const outcome = await runTool("search_notes", { query: "contract" }, ctx);

    expect(mockPrisma.capture.findMany.mock.calls[0][0].where).toMatchObject({ workspaceId: "ws-1", userId: "u-1" });
    expect(outcome.text).toContain("[N1]");
    expect(outcome.text).not.toContain("cap-1");
    expect(ctx.registry.get("N1")).toMatchObject({ kind: "note", captureId: "cap-1" });
  });

  it("lists this week's tasks by label, keeping one label per task", async () => {
    mockMyTasks.mockResolvedValue([task("a", "2026-10-16"), task("b", "2026-10-20"), task("c", "2026-12-01")]);
    const ctx = context();
    const outcome = await runTool("list_my_tasks", { filter: "week" }, ctx);

    expect(outcome.summary).toBe("2");
    expect(outcome.text).toMatch(/^T1: Task a/);
    expect(outcome.text).not.toContain("Task c");
    await runTool("list_my_tasks", { filter: "open" }, ctx);
    expect(ctx.registry.get("T1")).toMatchObject({ taskId: "a" });
    expect(ctx.registry.get("T3")).toMatchObject({ taskId: "c" });
  });

  it("will not read a task by a label it never issued", async () => {
    const outcome = await runTool("get_task", { task: "T9" }, context());
    expect(outcome.text).toContain("Unknown task label");
    expect(mockPrisma.task.findFirst).not.toHaveBeenCalled();
  });

  it("answers bad input with text the model can correct", async () => {
    const outcome = await runTool("search_documents", { query: "" }, context());
    expect(outcome.text).toContain("Invalid input");
  });

  it("saves a draft and labels it, never sends", async () => {
    mockDraft.mockResolvedValue({ id: "draft-1", subject: "Quote", body: "Hi Peter", flags: [] });
    const ctx = context();
    const outcome = await runTool("draft_email", { purpose: "follow_up", key_points: "chase the quote" }, ctx);

    expect(outcome.text).toContain("[D1] Draft saved");
    expect(outcome.text).toContain("Not sent");
    expect(ctx.draftIds).toEqual(["draft-1"]);
    expect(mockDraft.mock.calls[0][1]).toMatchObject({ purpose: "follow_up", keyPoints: "chase the quote" });
  });
});
