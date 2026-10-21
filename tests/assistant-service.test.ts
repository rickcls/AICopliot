import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The assistant's loop against a scripted fake model. What is under test is
 * the fence: a step cap and a time limit after which the model must answer,
 * malformed output that ends in an honest fallback, private threads, and a
 * prompt without database ids.
 */

const tx = {
  assistantMessage: { create: vi.fn() },
  assistantProposal: { createMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  assistantThread: { update: vi.fn() },
};
const mockPrisma = {
  assistantThread: { findFirst: vi.fn(), create: vi.fn() },
  assistantMessage: { findMany: vi.fn(), create: vi.fn() },
  assistantProposal: { findFirst: vi.fn(), findMany: vi.fn() },
  project: { findMany: vi.fn() },
  emailDraft: { findMany: vi.fn() },
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
};
const mockMyTasks = vi.fn(async (_workspaceId: string, _userId: string) => [] as OpenTask[]);
vi.mock("@/lib/pm/my-work", () => ({
  getMyOpenTasks: (workspaceId: string, userId: string) => mockMyTasks(workspaceId, userId),
}));
const { mockEnv } = vi.hoisted(() => ({
  mockEnv: vi.fn(() => ({ TAVILY_API_KEY: undefined as string | undefined })),
}));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/env", () => ({ getEnv: () => mockEnv() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/auth-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-guard")>()),
  getUserPreferences: vi.fn(async () => ({ locale: "en", timeZone: "Asia/Hong_Kong" })),
}));
const mockRunTool = vi.fn();
vi.mock("@/lib/assistant/tools", () => ({ runTool: mockRunTool }));
const mockApplyChange = vi.fn();
vi.mock("@/lib/capture/apply-change", () => ({ applyChange: mockApplyChange }));

const service = await import("@/lib/assistant/service");
const { MAX_TOOL_STEPS } = await import("@/lib/assistant/protocol");
const { ProviderError } = await import("@/lib/providers/types");

const access = {
  workspaceId: "ws-1",
  workspaceName: "Ops",
  userId: "u-1",
  role: "member" as const,
  user: { id: "u-1", email: "rick@example.com", name: "Rick" },
};
const NOW = new Date("2026-10-16T02:00:00Z");

/** A fake model that replays `replies` and records each prompt as it was sent. */
function scriptedChat(...replies: string[]) {
  const seen: { role: string; content: string }[][] = [];
  const complete = vi.fn(async (messages: { role: string; content: string }[]) => {
    seen.push(messages.map((message) => ({ ...message })));
    return replies.shift() ?? replies.at(-1) ?? "";
  });
  return { modelName: "fake", complete, seen };
}

interface OpenTask {
  id: string;
  title: string;
  dueDate: Date | null;
  priority: "low" | "medium" | "high" | "urgent";
  estimatedHours: null;
  updatedAt: Date;
  status: { key: string; label: string; category: "open" | "blocked" | "done" };
  project: { id: string; name: string };
  comments: [];
  snoozes: [];
}

function openTask(id: string, title: string, priority: OpenTask["priority"] = "medium"): OpenTask {
  return {
    id,
    title,
    dueDate: new Date("2026-10-20T00:00:00Z"),
    priority,
    estimatedHours: null,
    updatedAt: new Date("2026-10-15T00:00:00Z"),
    status: { key: "todo", label: "To do", category: "open" },
    project: { id: "project-secret", name: "Sales" },
    comments: [],
    snoozes: [],
  };
}

/** The rows just stored, which is what a later read of the same message sees. */
function storedProposals() {
  const data = (tx.assistantProposal.createMany.mock.calls[0]?.[0].data ?? []) as {
    kind: string;
    payload: unknown;
    taskId: string | null;
    flags: string[];
  }[];
  return data.map((row, index) => ({ id: `prop-${index}`, state: "pending" as const, ...row }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.mockReturnValue({ TAVILY_API_KEY: undefined });
  mockMyTasks.mockResolvedValue([]);
  mockPrisma.assistantProposal.findMany.mockResolvedValue([]);
  mockPrisma.assistantThread.create.mockResolvedValue({ id: "thread-1" });
  mockPrisma.assistantMessage.findMany.mockResolvedValue([]);
  mockPrisma.project.findMany.mockResolvedValue([{ id: "project-secret", name: "Sales", personalOwnerId: null }]);
  mockPrisma.emailDraft.findMany.mockResolvedValue([]);
  tx.assistantMessage.create.mockImplementation(async ({ data }) => ({ id: "msg-1", ...data }));
  mockRunTool.mockImplementation(async (_tool, _input, ctx) => {
    const source = ctx.registry.add("T", "task:task-secret", (label: string) => ({
      label,
      kind: "task",
      taskId: "task-secret",
      projectId: "project-secret",
      title: "Send quote",
      category: "open",
      dueDate: "2026-10-20",
      priority: "high",
      facts: "Send quote | due 2026-10-20",
    }));
    return { text: `${source.label}: Send quote | due 2026-10-20`, summary: "1" };
  });
});

describe("runAssistantTurn", () => {
  it("looks something up, then answers with what it found", async () => {
    const chat = scriptedChat(
      '{"action":"list_my_tasks","input":{"filter":"week"}}',
      '{"action":"answer","answer":"Send the quote by 20 Oct [T1].","citations":["T1"],"general":false,"proposals":[]}',
    );

    await service.runAssistantTurn(access, { question: "What is due this week?" }, { chat, now: NOW });

    expect(mockRunTool).toHaveBeenCalledTimes(1);
    const saved = tx.assistantMessage.create.mock.calls[0][0].data;
    expect(saved).toMatchObject({ role: "assistant", content: "Send the quote by 20 Oct [T1].", general: false });
    expect(saved.sources).toEqual([
      { label: "T1", kind: "task", taskId: "task-secret", projectId: "project-secret", title: "Send quote" },
    ]);
    expect(saved.steps).toEqual([{ tool: "list_my_tasks", input: "week", summary: "1" }]);
  });

  it("reports search_web as unknown when the switch is off, and does not run it", async () => {
    const chat = scriptedChat(
      '{"action":"search_web","input":{"query":"ABC quotation"}}',
      '{"action":"answer","answer":"I stayed inside your files.","citations":[],"general":true,"proposals":[]}',
    );

    await service.runAssistantTurn(access, { question: "What is a typical quote validity?", webSearch: false }, { chat, now: NOW });

    expect(mockRunTool).not.toHaveBeenCalled();
    expect(chat.seen[0][0].content).not.toContain("search_web");
    expect(chat.seen[1].at(-1)!.content).toContain('there is no tool called "search_web"');
  });

  it("runs search_web only when the switch is on and a key is set", async () => {
    mockEnv.mockReturnValue({ TAVILY_API_KEY: "tavily-test" });
    const chat = scriptedChat(
      '{"action":"search_web","input":{"query":"ABC quotation"}}',
      '{"action":"answer","answer":"From the web [W1].","citations":["W1"],"general":false,"proposals":[]}',
    );
    mockRunTool.mockImplementationOnce(async (_tool, _input, ctx) => {
      ctx.registry.add("W", "web:https://example.com/a", (label: string) => ({
        label,
        kind: "web",
        title: "ABC guide",
        url: "https://example.com/a",
        excerpt: "A snippet",
      }));
      return { text: "[W1] ABC guide\nhttps://example.com/a\nA snippet", summary: "1" };
    });

    await service.runAssistantTurn(access, { question: "What is a typical quote validity?", webSearch: true }, { chat, now: NOW });

    expect(mockRunTool).toHaveBeenCalledTimes(1);
    expect(mockRunTool.mock.calls[0][0]).toBe("search_web");
    expect(chat.seen[0][0].content).toContain("search_web");
    expect(JSON.stringify(chat.seen)).not.toContain("ws-1");
    const saved = tx.assistantMessage.create.mock.calls[0][0].data;
    expect(saved.general).toBe(false);
    expect(saved.sources).toEqual([
      { label: "W1", kind: "web", title: "ABC guide", url: "https://example.com/a", excerpt: "A snippet" },
    ]);
  });

  it("ignores a request for web search when no key is configured", async () => {
    const chat = scriptedChat(
      '{"action":"search_web","input":{"query":"ABC quotation"}}',
      '{"action":"answer","answer":"Nothing from the web.","citations":[],"general":true,"proposals":[]}',
    );

    await service.runAssistantTurn(access, { question: "Search the web", webSearch: true }, { chat, now: NOW });

    expect(mockRunTool).not.toHaveBeenCalled();
    expect(chat.seen[1].at(-1)!.content).toContain('there is no tool called "search_web"');
  });

  it("never sends a database id to the model", async () => {
    const chat = scriptedChat(
      '{"action":"list_my_tasks","input":{"filter":"open"}}',
      '{"action":"answer","answer":"Done [T1]","citations":["T1"]}',
    );
    await service.runAssistantTurn(access, { question: "What's open?" }, { chat, now: NOW });

    const everything = JSON.stringify(chat.seen);
    expect(everything).not.toContain("task-secret");
    expect(everything).not.toContain("project-secret");
    expect(everything).toContain("P1: Sales");
  });

  it("stops after the step cap and makes the model answer", async () => {
    const chat = scriptedChat(
      ...Array.from({ length: MAX_TOOL_STEPS + 3 }, () => '{"action":"list_my_tasks","input":{"filter":"open"}}'),
    );
    await service.runAssistantTurn(access, { question: "loop forever" }, { chat, now: NOW });

    expect(mockRunTool).toHaveBeenCalledTimes(MAX_TOOL_STEPS);
    // The capped turn, then one last call that may only answer.
    expect(chat.complete).toHaveBeenCalledTimes(MAX_TOOL_STEPS + 2);
    expect(chat.seen[MAX_TOOL_STEPS].at(-1)!.content).toContain("No more tools");
    expect(chat.seen.at(-1)!.at(-1)!.content).toContain("Do not call any tool");
    // It never answered, so the reply lists what the lookups found instead of
    // throwing them away.
    const saved = tx.assistantMessage.create.mock.calls[0][0].data;
    expect(saved.content).toContain("Here is what I found");
    expect(saved.content).toContain("Send quote [T1]");
    expect(saved).toMatchObject({ general: false });
    expect(saved.sources).toEqual([
      { label: "T1", kind: "task", taskId: "task-secret", projectId: "project-secret", title: "Send quote" },
    ]);
  });

  it("gets an answer from the last call when the capped turn asked for another tool", async () => {
    const chat = scriptedChat(
      ...Array.from({ length: MAX_TOOL_STEPS + 1 }, () => '{"action":"list_my_tasks","input":{"filter":"open"}}'),
      '{"action":"answer","answer":"Send the quote [T1].","citations":["T1"]}',
    );
    await service.runAssistantTurn(access, { question: "prepare my meeting" }, { chat, now: NOW });
    expect(tx.assistantMessage.create.mock.calls[0][0].data.content).toBe("Send the quote [T1].");
  });

  it("makes the model answer once the time limit has passed", async () => {
    let now = 0;
    const clock = () => now;
    const chat = scriptedChat(
      '{"action":"list_my_tasks","input":{"filter":"open"}}',
      '{"action":"answer","answer":"Here is what I found [T1].","citations":["T1"]}',
    );
    mockRunTool.mockImplementationOnce(async (_t, _i, ctx) => {
      now = 45_000;
      ctx.registry.add("T", "task:x", (label: string) => ({ label, kind: "task", taskId: "x", projectId: "p", title: "x", category: "open", dueDate: null, priority: "low", facts: "x" }));
      return { text: "T1: x", summary: "1" };
    });

    await service.runAssistantTurn(access, { question: "slow" }, { chat, now: NOW, clock });

    expect(chat.seen[1].at(-1)!.content).toContain("No more tools");
    expect(mockRunTool).toHaveBeenCalledTimes(1);
  });

  it("answers with what it found when a model call runs out of time", async () => {
    let now = 0;
    const clock = () => now;
    const chat = scriptedChat('{"action":"list_my_tasks","input":{"filter":"open"}}');
    chat.complete
      .mockImplementationOnce(async () => '{"action":"list_my_tasks","input":{"filter":"open"}}')
      .mockImplementationOnce(async () => {
        now = 50_000;
        throw new ProviderError("Model provider did not answer within 45s", 504);
      });

    await service.runAssistantTurn(access, { question: "slow" }, { chat, now: NOW, clock });

    // No time is left for a last call, and the turn is still saved.
    expect(chat.complete).toHaveBeenCalledTimes(2);
    const saved = tx.assistantMessage.create.mock.calls[0][0].data;
    expect(saved.content).toContain("Send quote [T1]");
  });

  it("falls back honestly after two malformed replies", async () => {
    const chat = scriptedChat("not json", "still not json");
    await service.runAssistantTurn(access, { question: "?" }, { chat, now: NOW });
    // Two malformed replies, then the one last call — still malformed.
    expect(chat.complete).toHaveBeenCalledTimes(3);
    // Nothing was looked up, so there is nothing to list.
    expect(tx.assistantMessage.create.mock.calls[0][0].data.content).toContain("could not finish");
  });

  it("refuses to continue someone else's conversation", async () => {
    mockPrisma.assistantThread.findFirst.mockResolvedValue(null);
    await expect(
      service.runAssistantTurn(access, { threadId: "thread-other", question: "hi" }, { chat: scriptedChat("{}"), now: NOW }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mockPrisma.assistantThread.findFirst.mock.calls[0][0].where).toEqual({
      id: "thread-other",
      workspaceId: "ws-1",
      userId: "u-1",
    });
  });

  it("stores proposals that clear the capture validator, and drops the rest", async () => {
    const chat = scriptedChat(
      JSON.stringify({
        action: "answer",
        answer: "I suggest a task.",
        citations: [],
        proposals: [
          { kind: "create_task", title: "Send quote", description: null, project: "P1", priority: null, due: null, estimatedHours: null, citations: ["U1"] },
          { kind: "create_task", title: "Uncited", description: null, project: null, priority: null, due: null, estimatedHours: null, citations: [] },
        ],
      }),
    );
    await service.runAssistantTurn(access, { question: "Add a task to send the quote" }, { chat, now: NOW });

    const rows = tx.assistantProposal.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "create_task", userId: "u-1", messageId: "msg-1" });
    expect(rows[0].payload.projectId).toBe("project-secret");
    expect(mockApplyChange).not.toHaveBeenCalled();
  });

  it("names a matching open task in the prompt, and never its id", async () => {
    mockMyTasks.mockResolvedValue([openTask("task-secret", "Send quote")]);
    const chat = scriptedChat(
      '{"action":"answer","answer":"Send quote is open [T1].","citations":["T1"],"proposals":[]}',
    );

    await service.runAssistantTurn(access, { question: "What is the status of Send quote?" }, { chat, now: NOW });

    const opening = chat.seen[0][1].content;
    expect(opening).toContain("T1: Send quote");
    expect(opening).toContain("priority medium");
    expect(opening).not.toContain("task-secret");
    expect(mockMyTasks).toHaveBeenCalledWith("ws-1", "u-1");
  });

  it("writes an unflagged priority, due date, and comment in the same turn", async () => {
    mockMyTasks.mockResolvedValue([openTask("task-secret", "Send quote")]);
    mockPrisma.assistantProposal.findMany.mockImplementation(async () =>
      storedProposals().map((row) => ({ id: row.id, flags: row.flags })),
    );
    mockPrisma.assistantProposal.findFirst.mockImplementation(
      async ({ where }: { where: { id: string } }) => storedProposals().find((row) => row.id === where.id),
    );
    mockApplyChange.mockResolvedValue({ ok: true, taskId: "task-secret", commentId: "c-1" });
    const chat = scriptedChat(
      JSON.stringify({
        action: "answer",
        answer: "I'll set Send quote to urgent, due next Friday, and add your comment [T1].",
        citations: ["T1"],
        proposals: [
          {
            kind: "update_task",
            task: "T1",
            status: null,
            priority: "urgent",
            due: { phrase: "next Friday", date: "2026-10-23" },
            citations: ["U1"],
          },
          { kind: "add_note", task: "T1", note: "Chased ABC", citations: ["U1"] },
        ],
      }),
    );

    await service.runAssistantTurn(
      access,
      { question: "Set Send quote to urgent, due next Friday, and add a comment: Chased ABC" },
      { chat, now: NOW },
    );

    expect(chat.seen[0][0].content).toContain("find_tasks");
    expect(chat.seen[0][0].content).not.toContain("You cannot change anything");
    const rows = tx.assistantProposal.createMany.mock.calls[0][0].data;
    expect(rows[0]).toMatchObject({
      kind: "update_task",
      taskId: "task-secret",
      flags: [],
      payload: { priority: "urgent", dueDate: "2026-10-23" },
    });
    expect(rows[1]).toMatchObject({ kind: "add_note", payload: { note: "Chased ABC" } });
    expect(mockApplyChange).toHaveBeenCalledTimes(2);
    expect(mockApplyChange.mock.calls[0][1]).toMatchObject({ kind: "update_task", taskId: "task-secret" });
    expect(mockApplyChange.mock.calls[1][1]).toMatchObject({ kind: "add_note", taskId: "task-secret" });
  });

  it("leaves a possible duplicate for Apply", async () => {
    mockMyTasks.mockResolvedValue([openTask("task-secret", "Send quote")]);
    mockPrisma.assistantProposal.findMany.mockImplementation(async () =>
      storedProposals().map((row) => ({ id: row.id, flags: row.flags })),
    );
    const chat = scriptedChat(
      JSON.stringify({
        action: "answer",
        answer: "That looks like the quote task you already have [T1].",
        citations: ["T1"],
        proposals: [
          {
            kind: "create_task",
            title: "Send quote",
            description: null,
            project: null,
            priority: null,
            status: null,
            due: null,
            estimatedHours: null,
            citations: ["U1"],
          },
        ],
      }),
    );

    await service.runAssistantTurn(access, { question: "Add a task: Send quote" }, { chat, now: NOW });

    expect(tx.assistantProposal.createMany.mock.calls[0][0].data[0].flags).toContain("possible_duplicate");
    expect(mockApplyChange).not.toHaveBeenCalled();
  });
});

describe("applyAssistantProposals", () => {
  it("applies through the shared write path, claiming the caller's own pending proposal", async () => {
    mockPrisma.assistantProposal.findFirst.mockResolvedValue({
      id: "prop-1",
      kind: "create_task",
      state: "pending",
      payload: { title: "Send quote" },
      taskId: null,
    });
    mockApplyChange.mockImplementation(async (_access, _change, _overrides, hooks) => {
      tx.assistantProposal.updateMany.mockResolvedValue({ count: 1 });
      expect(await hooks.claim(tx)).toBe(true);
      return { ok: true, taskId: "task-new", commentId: null };
    });

    const [result] = await service.applyAssistantProposals(access, "msg-1", [{ proposalId: "prop-1" }], NOW);

    expect(result).toEqual({ proposalId: "prop-1", ok: true, taskId: "task-new", commentId: null });
    expect(mockPrisma.assistantProposal.findFirst.mock.calls[0][0].where).toEqual({
      id: "prop-1",
      messageId: "msg-1",
      workspaceId: "ws-1",
      userId: "u-1",
    });
    expect(tx.assistantProposal.updateMany.mock.calls[0][0].where).toEqual({
      id: "prop-1",
      workspaceId: "ws-1",
      userId: "u-1",
      state: "pending",
    });
  });

  it("refuses a proposal already decided", async () => {
    mockPrisma.assistantProposal.findFirst.mockResolvedValue({ id: "prop-1", kind: "add_note", state: "applied", payload: {}, taskId: "t" });
    const [result] = await service.applyAssistantProposals(access, "msg-1", [{ proposalId: "prop-1" }], NOW);
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(mockApplyChange).not.toHaveBeenCalled();
  });
});
