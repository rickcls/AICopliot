import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_STEPS, validateApproach } from "@/lib/approach/approach";
import { stepsAsDescription, stepTitle } from "@/lib/approach/format";

const chunk = (id: string, content: string) => ({
  id,
  documentId: `doc-${id}`,
  filename: `${id}.pdf`,
  content,
  chunkIndex: 0,
  pageNumber: 3,
  sectionTitle: null,
});
const sourceMap = new Map([
  ["S1", chunk("c1", "报价须于十一月三十日前经财务批核。")],
  ["S2", chunk("c2", "Vendor onboarding needs a signed NDA.")],
]);

describe("validateApproach", () => {
  it("calls a step 'document' only when it cites a passage the model was given", () => {
    const result = validateApproach(
      {
        steps: [
          { text: "Get finance approval before 30 Nov.", citations: ["S1"] },
          { text: "Ask the vendor for references.", citations: [] },
          { text: "Follow the onboarding policy.", citations: ["S9"] },
        ],
        note: null,
      },
      sourceMap,
      "en",
    );
    expect(result.steps.map((step) => [step.basis, step.citations])).toEqual([
      ["document", ["S1"]],
      ["general", []],
      ["general", []],
    ]);
  });

  it("returns only the sources actually cited, in their own words", () => {
    const result = validateApproach(
      { steps: [{ text: "批核報價", citations: ["S1", "S1"] }], note: null },
      sourceMap,
      "zh-Hant",
    );
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({ label: "S1", chunkId: "c1", documentId: "doc-c1", pageNumber: 3 });
    // The excerpt is the source's own text: Simplified stays Simplified.
    expect(result.sources[0].excerpt).toBe("报价须于十一月三十日前经财务批核。");
  });

  it("writes the model's own words in Traditional characters", () => {
    const result = validateApproach(
      { steps: [{ text: "先联络财务部", citations: [] }], note: "这是建议" },
      sourceMap,
      "zh-Hant",
    );
    expect(result.steps[0].text).toBe("先聯絡財務部");
    expect(result.note).toBe("這是建議");
  });

  it("caps the number of steps", () => {
    const steps = Array.from({ length: 15 }, (_, i) => ({ text: `Step ${i}`, citations: [] }));
    expect(validateApproach({ steps, note: null }, sourceMap, "en").steps).toHaveLength(MAX_STEPS);
  });
});

describe("approach formatting", () => {
  it("marks general steps when added to a description", () => {
    expect(
      stepsAsDescription(
        [
          { text: "Get approval.", basis: "document", citations: ["S1"] },
          { text: "Call the vendor.", basis: "general", citations: [] },
        ],
        "【AI 建議】",
      ),
    ).toBe("1. Get approval.\n2. 【AI 建議】 Call the vendor.");
  });

  it("titles a task with the step's first sentence", () => {
    expect(stepTitle("Call the vendor. Ask for three references.")).toBe("Call the vendor.");
    expect(stepTitle("聯絡財務部。確認預算。")).toBe("聯絡財務部。");
    expect(stepTitle("x".repeat(200))).toHaveLength(120);
  });
});

// --- Service ---------------------------------------------------------------

const tx = { taskSuggestion: { updateMany: vi.fn() } };
const mockPrisma = {
  task: { findFirst: vi.fn() },
  taskDocument: { findMany: vi.fn() },
  taskSuggestion: { create: vi.fn(), findFirst: vi.fn() },
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ RAG_MIN_SCORE: 0.25 }) }));
vi.mock("@/lib/auth-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-guard")>()),
  getUserPreferences: vi.fn(async () => ({ locale: "en", timeZone: "Asia/Hong_Kong" })),
}));
const mockRetrieve = vi.fn();
vi.mock("@/lib/rag/retrieve", () => ({ retrieveChunks: mockRetrieve }));
const writes = { prepareTaskCreate: vi.fn(), createTaskRecord: vi.fn() };
vi.mock("@/lib/pm/task-write", () => writes);

const service = await import("@/lib/approach/service");
const access = { workspaceId: "ws-1", workspaceName: "Ops", userId: "u-1", role: "member" as const };

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.task.findFirst.mockResolvedValue({
    id: "t1",
    title: "Onboard the new vendor",
    description: null,
    projectId: "p1",
    dueDate: null,
    project: { name: "Ops" },
    status: { category: "open" },
  });
  mockPrisma.taskDocument.findMany.mockResolvedValue([]);
  mockRetrieve.mockResolvedValue([]);
  mockPrisma.taskSuggestion.create.mockImplementation(async ({ data }) => ({
    id: "sug-1",
    ...data,
    createdSteps: [],
    createdAt: new Date("2026-10-16T02:00:00Z"),
  }));
});

describe("suggestApproach", () => {
  it("still asks the model with no evidence, and every step comes back general", async () => {
    const chat = {
      modelName: "fake",
      complete: vi.fn(async () =>
        JSON.stringify({ steps: [{ text: "Ask for the vendor's tax form.", citations: ["S1"] }], note: null }),
      ),
    };
    const embeddings = { modelName: "e", dimensions: 3, embed: vi.fn(async () => [[0, 0, 1]]) };

    const view = await service.suggestApproach(access, "t1", { chat, embeddings });

    expect(chat.complete).toHaveBeenCalledTimes(1);
    expect(view.evidence).toBe("none");
    expect(view.steps[0]).toMatchObject({ basis: "general", citations: [] });
    expect(JSON.stringify(chat.complete.mock.calls[0])).not.toContain("t1");
    expect(mockPrisma.taskSuggestion.create.mock.calls[0][0].data).toMatchObject({
      workspaceId: "ws-1",
      userId: "u-1",
      taskId: "t1",
    });
  });

  it("resolves only an official task in the caller's workspace", async () => {
    mockPrisma.task.findFirst.mockResolvedValue(null);
    await expect(service.suggestApproach(access, "t-x", {})).rejects.toMatchObject({ status: 404 });
    expect(mockPrisma.task.findFirst.mock.calls[0][0].where).toMatchObject({ id: "t-x", workspaceId: "ws-1" });
  });
});

describe("createTasksFromSteps", () => {
  beforeEach(() => {
    mockPrisma.taskSuggestion.findFirst.mockResolvedValue({
      id: "sug-1",
      steps: [
        { text: "Confirm the budget with finance. Then sign.", basis: "document", citations: ["S1"] },
        { text: "Call the vendor.", basis: "general", citations: [] },
      ],
      task: { projectId: "p1", title: "Onboard the new vendor" },
    });
    writes.prepareTaskCreate.mockResolvedValue({ ok: true, value: { prepared: true } });
    writes.createTaskRecord.mockResolvedValue({ id: "task-new" });
  });

  it("creates the task in the same project, assigned to the person, marking general steps", async () => {
    tx.taskSuggestion.updateMany.mockResolvedValue({ count: 1 });

    const created = await service.createTasksFromSteps(access, "sug-1", [1], "[AI suggestion]");

    expect(created).toEqual([{ id: "task-new" }]);
    const [workspaceId, projectId, input] = writes.prepareTaskCreate.mock.calls[0];
    expect([workspaceId, projectId]).toEqual(["ws-1", "p1"]);
    expect(input).toMatchObject({ title: "Call the vendor.", assigneeId: "u-1" });
    expect(input.description.startsWith("[AI suggestion] Call the vendor.")).toBe(true);
    expect(tx.taskSuggestion.updateMany).toHaveBeenCalledWith({
      where: { id: "sug-1", userId: "u-1", NOT: { createdSteps: { has: 1 } } },
      data: { createdSteps: { push: 1 } },
    });
  });

  it("creates nothing for a step already turned into a task", async () => {
    tx.taskSuggestion.updateMany.mockResolvedValue({ count: 0 });
    expect(await service.createTasksFromSteps(access, "sug-1", [0], "x")).toEqual([]);
    expect(writes.createTaskRecord).not.toHaveBeenCalled();
  });

  it("only reads the caller's own suggestion", async () => {
    mockPrisma.taskSuggestion.findFirst.mockResolvedValue(null);
    await expect(service.createTasksFromSteps(access, "sug-other", [0], "x")).rejects.toMatchObject({ status: 404 });
    expect(mockPrisma.taskSuggestion.findFirst.mock.calls[0][0].where).toEqual({
      id: "sug-other",
      workspaceId: "ws-1",
      userId: "u-1",
    });
  });
});
