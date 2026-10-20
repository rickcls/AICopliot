import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Capture service against a mocked Prisma and a fake model. What is under test
 * is the order of operations (the note is stored before the model runs), what
 * the prompt contains (labels, never ids), and the per-user scoping and
 * conditional claim on Apply.
 */

const tx = {
  captureProposal: { updateMany: vi.fn(), update: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
};
const mockPrisma = {
  $queryRaw: vi.fn(),
  capture: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  captureProposal: { createMany: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  document: { findFirst: vi.fn() },
  project: { findFirst: vi.fn(), findMany: vi.fn() },
  task: { findFirst: vi.fn() },
  projectTaskStatus: { findMany: vi.fn() },
  $transaction: vi.fn(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (t: typeof tx) => unknown)(tx) : Promise.all(arg as unknown[]),
  ),
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("server-only", () => ({}));

const mockPreferences = vi.fn();
vi.mock("@/lib/auth-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-guard")>()),
  getUserPreferences: mockPreferences,
}));

const mockContext = vi.fn();
vi.mock("@/lib/capture/context", () => ({ loadCaptureContext: mockContext }));

const writes = {
  prepareTaskCreate: vi.fn(),
  createTaskRecord: vi.fn(),
  prepareTaskUpdate: vi.fn(),
  updateTaskRecord: vi.fn(),
  findCommentableTask: vi.fn(),
  createTaskCommentRecord: vi.fn(),
};
vi.mock("@/lib/pm/task-write", () => writes);

const mockPersonal = vi.fn();
vi.mock("@/lib/pm/personal-project", () => ({ getOrCreatePersonalProject: mockPersonal }));

const mockStore = vi.fn();
vi.mock("@/lib/documents/store", () => ({ storeDocument: mockStore }));

const service = await import("@/lib/capture/service");

const access = {
  workspaceId: "ws-1",
  workspaceName: "Ops",
  userId: "u-1",
  role: "member" as const,
  user: { id: "u-1", email: "rick@example.com", name: "Rick" },
};
const NOW = new Date("2026-10-16T02:00:00Z"); // 10:00 in Hong Kong

function fakeChat(...replies: string[]) {
  const complete = vi.fn();
  for (const reply of replies) complete.mockResolvedValueOnce(reply);
  return { modelName: "fake-model", complete };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPreferences.mockResolvedValue({ locale: "zh-Hant", timeZone: "Asia/Hong_Kong" });
  mockPrisma.capture.create.mockResolvedValue({ id: "cap-1" });
  mockPrisma.capture.findFirst.mockResolvedValue({
    id: "cap-1",
    body: "聽日要send報價俾ABC公司\n月報已經交咗",
    localDate: new Date("2026-10-16T00:00:00Z"),
    timeZone: "Asia/Hong_Kong",
    replyLanguage: "zh-Hant",
  });
  mockContext.mockResolvedValue({
    promptTasks: [
      { label: "T1", title: "提交月報", projectLabel: "P1", category: "open", dueDate: null, priority: "medium" },
    ],
    promptProjects: [{ label: "P1", name: "Rick的個人工作", personal: true }],
    projectLabels: new Map([["P1", "project-secret-id"]]),
    taskLabels: new Map([
      ["T1", { id: "task-secret-id", title: "提交月報", category: "open", dueDate: null, priority: "medium" }],
    ]),
  });
});

describe("createCapture", () => {
  it("stores the note on the person's own day before calling the model", async () => {
    const chat = fakeChat('{"proposals":[]}');
    await service.createCapture(access, { text: "聽日要send報價俾ABC公司", source: "text" }, { chat, now: NOW });

    const data = mockPrisma.capture.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      workspaceId: "ws-1",
      userId: "u-1",
      status: "processing",
      source: "text",
      replyLanguage: "zh-Hant",
      timeZone: "Asia/Hong_Kong",
    });
    expect(data.localDate.toISOString()).toBe("2026-10-16T00:00:00.000Z");
    expect(mockPrisma.capture.create.mock.invocationCallOrder[0]).toBeLessThan(
      chat.complete.mock.invocationCallOrder[0],
    );
  });

  it("detects English input and asks for English", async () => {
    const chat = fakeChat('{"proposals":[]}');
    await service.createCapture(access, { text: "Send the quote to ABC tomorrow", source: "text" }, { chat, now: NOW });
    expect(mockPrisma.capture.create.mock.calls[0][0].data.replyLanguage).toBe("en");
  });
});

describe("proposeForCapture", () => {
  it("sends labels and never a database id", async () => {
    const chat = fakeChat('{"proposals":[]}');
    await service.proposeForCapture(access, "cap-1", { chat, now: NOW });

    const prompt = JSON.stringify(chat.complete.mock.calls[0][0]);
    expect(prompt).toContain("[C1]");
    expect(prompt).toContain("T1: 提交月報");
    expect(prompt).toContain("TODAY: 2026-10-16 (Friday)");
    expect(prompt).not.toContain("task-secret-id");
    expect(prompt).not.toContain("project-secret-id");
    expect(prompt).not.toContain("cap-1");
  });

  it("stores validated proposals with resolved ids and marks the capture ready", async () => {
    const chat = fakeChat(
      JSON.stringify({
        proposals: [
          { kind: "update_task", task: "T1", status: "done", priority: null, due: null, citations: ["C2"] },
          { kind: "create_task", title: "Send quote", description: null, project: "P1", priority: null, due: { phrase: "聽日", date: "2026-10-17" }, estimatedHours: null, citations: ["C1"] },
        ],
      }),
    );
    await service.proposeForCapture(access, "cap-1", { chat, now: NOW });

    const rows = mockPrisma.captureProposal.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "update_task", taskId: "task-secret-id", userId: "u-1", position: 0 });
    expect(rows[1].payload).toMatchObject({ projectId: "project-secret-id", dueDate: "2026-10-17" });
    expect(mockPrisma.capture.update.mock.calls[0][0].data).toMatchObject({
      status: "ready",
      modelName: "fake-model",
    });
  });

  it("repairs malformed JSON once", async () => {
    const chat = fakeChat("not json", '{"proposals":[]}');
    await service.proposeForCapture(access, "cap-1", { chat, now: NOW });
    expect(chat.complete).toHaveBeenCalledTimes(2);
    expect(mockPrisma.capture.update.mock.calls[0][0].data.status).toBe("ready");
  });

  it("keeps the note and marks it failed when the model fails", async () => {
    const chat = { modelName: "fake", complete: vi.fn().mockRejectedValue(new Error("boom")) };
    await service.proposeForCapture(access, "cap-1", { chat, now: NOW });

    const update = mockPrisma.capture.update.mock.calls[0][0];
    expect(update.data.status).toBe("failed");
    expect(update.data).not.toHaveProperty("body");
    expect(mockPrisma.captureProposal.createMany).not.toHaveBeenCalled();
  });

  it("only reads the caller's own capture", async () => {
    const chat = fakeChat('{"proposals":[]}');
    await service.proposeForCapture(access, "cap-1", { chat, now: NOW });
    expect(mockPrisma.capture.findFirst.mock.calls[0][0].where).toEqual({
      id: "cap-1",
      workspaceId: "ws-1",
      userId: "u-1",
    });
  });
});

describe("applyProposal", () => {
  const createProposal = {
    id: "prop-1",
    kind: "create_task",
    state: "pending",
    taskId: null,
    payload: {
      title: "Send quote",
      description: null,
      projectId: null,
      priority: null,
      dueDate: "2026-10-17",
      duePhrase: "聽日",
      estimatedHours: null,
    },
    capture: { documentId: null, document: null },
  };

  beforeEach(() => {
    mockPersonal.mockResolvedValue({ id: "personal-1", name: "Rick的個人工作" });
    writes.prepareTaskCreate.mockResolvedValue({ ok: true, value: { prepared: true } });
    writes.createTaskRecord.mockResolvedValue({ id: "task-new" });
  });

  it("looks the proposal up within the caller's own captures", async () => {
    mockPrisma.captureProposal.findFirst.mockResolvedValue(null);

    const result = await service.applyProposal(access, "prop-elsewhere", {}, NOW);

    expect(result).toMatchObject({ ok: false, status: 404 });
    expect(mockPrisma.captureProposal.findFirst.mock.calls[0][0].where).toEqual({
      id: "prop-elsewhere",
      workspaceId: "ws-1",
      userId: "u-1",
    });
  });

  it("creates the task in the personal project, assigned to the person, through task-write", async () => {
    mockPrisma.captureProposal.findFirst.mockResolvedValue(createProposal);
    tx.captureProposal.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.applyProposal(access, "prop-1", {}, NOW);

    expect(result).toEqual({ proposalId: "prop-1", ok: true, taskId: "task-new", commentId: null });
    const [workspaceId, projectId, input] = writes.prepareTaskCreate.mock.calls[0];
    expect(workspaceId).toBe("ws-1");
    expect(projectId).toBe("personal-1");
    expect(input).toMatchObject({ title: "Send quote", assigneeId: "u-1", priority: "medium" });
    expect(input.dueDate.toISOString()).toBe("2026-10-17T00:00:00.000Z");
    expect(writes.createTaskRecord.mock.calls[0][0]).toBe(tx);
  });

  it("claims the proposal conditionally in the same transaction as the write", async () => {
    mockPrisma.captureProposal.findFirst.mockResolvedValue(createProposal);
    tx.captureProposal.updateMany.mockResolvedValue({ count: 1 });

    await service.applyProposal(access, "prop-1", {}, NOW);

    expect(tx.captureProposal.updateMany).toHaveBeenCalledWith({
      where: { id: "prop-1", workspaceId: "ws-1", userId: "u-1", state: "pending" },
      data: { state: "applied", decidedAt: NOW },
    });
    expect(tx.captureProposal.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      writes.createTaskRecord.mock.invocationCallOrder[0],
    );
  });

  it("lets only one of two simultaneous Applies write", async () => {
    mockPrisma.captureProposal.findFirst.mockResolvedValue(createProposal);
    tx.captureProposal.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.applyProposal(access, "prop-1", {}, NOW);

    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(writes.createTaskRecord).not.toHaveBeenCalled();
  });

  it("refuses a proposal that was already decided", async () => {
    mockPrisma.captureProposal.findFirst.mockResolvedValue({ ...createProposal, state: "applied" });
    expect(await service.applyProposal(access, "prop-1", {}, NOW)).toMatchObject({ ok: false, status: 409 });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("lets the person's edits override the proposal", async () => {
    mockPrisma.captureProposal.findFirst.mockResolvedValue(createProposal);
    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-abc" });
    tx.captureProposal.updateMany.mockResolvedValue({ count: 1 });

    await service.applyProposal(
      access,
      "prop-1",
      { title: "Send the ABC quote", projectId: "project-abc", dueDate: null, priority: "urgent" },
      NOW,
    );

    expect(mockPrisma.project.findFirst.mock.calls[0][0].where).toEqual({
      id: "project-abc",
      workspaceId: "ws-1",
    });
    const [, projectId, input] = writes.prepareTaskCreate.mock.calls[0];
    expect(projectId).toBe("project-abc");
    expect(input).toMatchObject({ title: "Send the ABC quote", priority: "urgent", dueDate: null });
  });

  it("creates a waiting task in the project's blocked column", async () => {
    mockPrisma.captureProposal.findFirst.mockResolvedValue({
      ...createProposal,
      payload: { ...createProposal.payload, status: "blocked", projectId: "project-1" },
    });
    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1" });
    mockPrisma.projectTaskStatus.findMany.mockResolvedValue([
      { id: "s-open", key: "backlog", category: "open", position: 0 },
      { id: "s-blocked", key: "blocked", category: "blocked", position: 3 },
    ]);
    tx.captureProposal.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.applyProposal(access, "prop-1", {}, NOW);

    expect(result).toMatchObject({ ok: true, taskId: "task-new" });
    expect(writes.prepareTaskCreate.mock.calls[0][2]).toMatchObject({ statusId: "s-blocked" });
  });

  it("refuses a new blocked task when the project has no blocked column", async () => {
    mockPrisma.captureProposal.findFirst.mockResolvedValue({
      ...createProposal,
      payload: { ...createProposal.payload, status: "blocked", projectId: "project-1" },
    });
    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1" });
    mockPrisma.projectTaskStatus.findMany.mockResolvedValue([
      { id: "s-open", key: "backlog", category: "open", position: 0 },
    ]);

    expect(await service.applyProposal(access, "prop-1", {}, NOW)).toMatchObject({ ok: false, status: 409 });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("moves a task to its project's done column", async () => {
    mockPrisma.captureProposal.findFirst.mockResolvedValue({
      id: "prop-2",
      kind: "update_task",
      state: "pending",
      taskId: "task-report",
      payload: { status: "done", priority: null, dueDate: null, duePhrase: null },
      capture: { documentId: null, document: null },
    });
    mockPrisma.task.findFirst.mockResolvedValue({ id: "task-report", projectId: "project-1" });
    mockPrisma.projectTaskStatus.findMany.mockResolvedValue([
      { id: "s-open", key: "backlog", category: "open", position: 0 },
      { id: "s-done", key: "done", category: "done", position: 4 },
    ]);
    writes.prepareTaskUpdate.mockResolvedValue({ ok: true, value: { prepared: true } });
    tx.captureProposal.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.applyProposal(access, "prop-2", {}, NOW);

    expect(result).toMatchObject({ ok: true, taskId: "task-report" });
    expect(writes.prepareTaskUpdate.mock.calls[0][2]).toEqual({ statusId: "s-done" });
  });

  it("says so when the project has no column for blocked work", async () => {
    mockPrisma.captureProposal.findFirst.mockResolvedValue({
      id: "prop-3",
      kind: "update_task",
      state: "pending",
      taskId: "task-x",
      payload: { status: "blocked", priority: null, dueDate: null, duePhrase: null },
      capture: { documentId: null, document: null },
    });
    mockPrisma.task.findFirst.mockResolvedValue({ id: "task-x", projectId: "project-1" });
    mockPrisma.projectTaskStatus.findMany.mockResolvedValue([
      { id: "s-done", key: "done", category: "done", position: 4 },
    ]);

    expect(await service.applyProposal(access, "prop-3", {}, NOW)).toMatchObject({ ok: false, status: 409 });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("writes a progress note as the person, never anyone else", async () => {
    mockPrisma.captureProposal.findFirst.mockResolvedValue({
      id: "prop-4",
      kind: "add_note",
      state: "pending",
      taskId: "task-contract",
      payload: { note: "等緊Peter覆" },
      capture: { documentId: null, document: null },
    });
    writes.findCommentableTask.mockResolvedValue({ id: "task-contract" });
    writes.createTaskCommentRecord.mockResolvedValue({ id: "comment-1" });
    tx.captureProposal.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.applyProposal(access, "prop-4", {}, NOW);

    expect(result).toMatchObject({ ok: true, commentId: "comment-1" });
    expect(writes.createTaskCommentRecord.mock.calls[0][1]).toEqual({
      workspaceId: "ws-1",
      taskId: "task-contract",
      authorId: "u-1",
      body: "等緊Peter覆",
    });
  });
});

describe("applyProposal assignee", () => {
  const createProposal = {
    id: "prop-1",
    kind: "create_task",
    state: "pending",
    taskId: null,
    payload: {
      title: "Send quote",
      description: "聽日要send報價俾ABC公司",
      projectId: null,
      priority: null,
      dueDate: null,
      duePhrase: null,
      estimatedHours: null,
    },
    capture: { documentId: null, document: null },
  };

  beforeEach(() => {
    mockPersonal.mockResolvedValue({ id: "personal-1", name: "Rick的個人工作" });
    writes.createTaskRecord.mockResolvedValue({ id: "task-new" });
    mockPrisma.captureProposal.findFirst.mockResolvedValue(createProposal);
    tx.captureProposal.updateMany.mockResolvedValue({ count: 1 });
  });

  it("hands a new task to the colleague the person picked, with its description", async () => {
    writes.prepareTaskCreate.mockResolvedValue({ ok: true, value: { prepared: true } });

    await service.applyProposal(access, "prop-1", { assigneeId: "u-2" }, NOW);

    expect(writes.prepareTaskCreate.mock.calls[0][2]).toMatchObject({
      assigneeId: "u-2",
      description: "聽日要send報價俾ABC公司",
    });
  });

  it("refuses an assignee who is not in the workspace", async () => {
    const { AuthError } = await import("@/lib/auth-guard");
    writes.prepareTaskCreate.mockRejectedValue(new AuthError("Member not found", 404));

    const result = await service.applyProposal(access, "prop-1", { assigneeId: "u-outsider" }, NOW);

    expect(result).toMatchObject({ ok: false, status: 404 });
    expect(writes.createTaskRecord).not.toHaveBeenCalled();
  });
});

describe("reviseProposal", () => {
  const body = "聽日要send報價俾ABC公司\n月報已經交咗";
  const wrongUpdate = {
    id: "prop-2",
    kind: "update_task",
    state: "pending",
    payload: { status: "done", priority: null, dueDate: null, duePhrase: null },
    citations: [{ label: "C2", text: "月報已經交咗" }],
    position: 1,
    taskId: "task-secret-id",
    task: { title: "提交月報" },
    capture: {
      id: "cap-1",
      body,
      localDate: new Date("2026-10-16T00:00:00Z"),
      timeZone: "Asia/Hong_Kong",
      replyLanguage: "zh-Hant",
      source: "text",
    },
  };
  const newTask = JSON.stringify({
    proposals: [
      {
        kind: "create_task",
        title: "交季度報告",
        description: null,
        project: null,
        priority: null,
        status: null,
        due: { phrase: "下星期五", date: "2026-10-23" },
        estimatedHours: null,
        citations: ["C3"],
      },
    ],
  });

  beforeEach(() => {
    mockPrisma.captureProposal.findFirst.mockResolvedValue(wrongUpdate);
    mockPrisma.captureProposal.findMany.mockResolvedValue([]);
    mockPrisma.$queryRaw.mockImplementation(async (_sql: unknown, appended: string) => [
      { body: body + appended },
    ]);
    tx.captureProposal.deleteMany.mockResolvedValue({ count: 1 });
  });

  it("adds the correction to the note before the model runs, and asks by label only", async () => {
    const chat = fakeChat(newTask);

    await service.reviseProposal(access, "prop-2", "季度報告係新工作，下星期五交", { chat, now: NOW });

    expect(mockPrisma.$queryRaw.mock.calls[0][1]).toBe("\n\n補充：季度報告係新工作，下星期五交");
    expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      chat.complete.mock.invocationCallOrder[0],
    );
    const prompt = JSON.stringify(chat.complete.mock.calls[0][0]);
    expect(prompt).toContain("REVISE ONE SUGGESTION");
    expect(prompt).toContain("update T1");
    expect(prompt).toContain("Their correction is C3");
    expect(prompt).not.toContain("task-secret-id");
    expect(prompt).not.toContain("project-secret-id");
  });

  it("replaces the suggestion where it was, claiming it in the same transaction", async () => {
    await service.reviseProposal(access, "prop-2", "季度報告係新工作，下星期五交", {
      chat: fakeChat(newTask),
      now: NOW,
    });

    expect(tx.captureProposal.deleteMany).toHaveBeenCalledWith({
      where: { id: "prop-2", workspaceId: "ws-1", userId: "u-1", state: "pending" },
    });
    const [replacement] = tx.captureProposal.createMany.mock.calls[0][0].data;
    expect(replacement).toMatchObject({
      kind: "create_task",
      position: 1,
      taskId: null,
      workspaceId: "ws-1",
      userId: "u-1",
      // The date is the server's own reading of "下星期五", and with no
      // description the task keeps the correction itself, marker removed.
      payload: { title: "交季度報告", dueDate: "2026-10-23", description: "季度報告係新工作，下星期五交" },
    });
  });

  it("shows the other suggestions, and flags a replacement that repeats one", async () => {
    mockPrisma.captureProposal.findMany.mockResolvedValue([
      { kind: "create_task", payload: { title: "交季度報告" }, task: null },
    ]);
    const chat = fakeChat(newTask);

    await service.reviseProposal(access, "prop-2", "季度報告係新工作，下星期五交", { chat, now: NOW });

    expect(mockPrisma.captureProposal.findMany.mock.calls[0][0].where).toMatchObject({
      captureId: "cap-1",
      workspaceId: "ws-1",
      userId: "u-1",
      state: "pending",
      NOT: { id: "prop-2" },
    });
    expect(JSON.stringify(chat.complete.mock.calls[0][0])).toContain('new task \\"交季度報告\\"');
    const [replacement] = tx.captureProposal.createMany.mock.calls[0][0].data;
    expect(replacement.flags).toContain("possible_duplicate");
  });

  it("refuses a suggestion that was already applied, before touching the note", async () => {
    mockPrisma.captureProposal.findFirst.mockResolvedValue({ ...wrongUpdate, state: "applied" });
    const chat = fakeChat(newTask);

    await expect(
      service.reviseProposal(access, "prop-2", "季度報告係新工作", { chat, now: NOW }),
    ).rejects.toMatchObject({ status: 409 });
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    expect(chat.complete).not.toHaveBeenCalled();
  });

  it("keeps the old suggestion when nothing valid comes back", async () => {
    await expect(
      service.reviseProposal(access, "prop-2", "唔啱", {
        chat: fakeChat(JSON.stringify({ proposals: [] })),
        now: NOW,
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(tx.captureProposal.deleteMany).not.toHaveBeenCalled();
    // The correction is the person's own words, so it stays in the note.
    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
  });

  it("does not replace a suggestion applied while the model was answering", async () => {
    tx.captureProposal.deleteMany.mockResolvedValue({ count: 0 });

    await expect(
      service.reviseProposal(access, "prop-2", "季度報告係新工作，下星期五交", {
        chat: fakeChat(newTask),
        now: NOW,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.captureProposal.createMany).not.toHaveBeenCalled();
  });

  it("only finds the caller's own suggestion", async () => {
    mockPrisma.captureProposal.findFirst.mockResolvedValue(null);

    await expect(
      service.reviseProposal(access, "prop-other", "季度報告係新工作", { chat: fakeChat(newTask), now: NOW }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mockPrisma.captureProposal.findFirst.mock.calls[0][0].where).toEqual({
      id: "prop-other",
      workspaceId: "ws-1",
      userId: "u-1",
    });
  });
});

describe("saveCaptureAsDocument", () => {
  beforeEach(() => {
    mockPrisma.project.findMany.mockResolvedValue([
      { id: "personal-1", name: "Rick的個人工作", personalOwnerId: "u-1" },
    ]);
    mockStore.mockResolvedValue({ ok: true, id: "doc-new" });
  });

  it("stores the note through the validated path, in the personal project", async () => {
    mockPrisma.capture.findFirst.mockResolvedValue({
      id: "cap-1",
      body: "會議重點",
      source: "text",
      documentId: null,
      localDate: new Date("2026-10-16T00:00:00Z"),
    });

    expect(await service.saveCaptureAsDocument(access, "cap-1")).toEqual({ documentId: "doc-new" });
    expect(mockStore.mock.calls[0][0]).toMatchObject({
      workspaceId: "ws-1",
      projectId: "personal-1",
      filename: "note-2026-10-16.md",
    });
    expect(mockPrisma.capture.updateMany.mock.calls[0][0].where).toMatchObject({
      id: "cap-1",
      userId: "u-1",
      documentId: null,
    });
  });

  it("saves a note once", async () => {
    mockPrisma.capture.findFirst.mockResolvedValue({
      id: "cap-1",
      body: "x",
      source: "text",
      documentId: "doc-old",
      localDate: new Date("2026-10-16T00:00:00Z"),
    });
    await expect(service.saveCaptureAsDocument(access, "cap-1")).rejects.toMatchObject({ status: 409 });
    expect(mockStore).not.toHaveBeenCalled();
  });
});

