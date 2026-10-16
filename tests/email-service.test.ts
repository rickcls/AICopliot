import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  writingStyle: { findUnique: vi.fn(), upsert: vi.fn() },
  task: { findFirst: vi.fn() },
  emailDraft: { create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-guard")>()),
  getUserPreferences: vi.fn(async () => ({ locale: "zh-Hant", timeZone: "Asia/Hong_Kong" })),
}));

const service = await import("@/lib/email/service");
const access = { workspaceId: "ws-1", workspaceName: "Ops", userId: "u-1", role: "member" as const };

function fakeChat(reply: object) {
  return {
    modelName: "writer",
    complete: vi.fn(async (_messages: { role: string; content: string }[]) => JSON.stringify(reply)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.writingStyle.findUnique.mockResolvedValue({
    samples: [
      "Hi Peter,\nThanks for the update. Will revert by Friday.\nCheers,\nRick",
      "各位好，\n附上上星期的會議記錄，請查閱。\nRick",
      "Hi team, quick one — please send me the figures. Thanks! Rick",
    ],
    profile: "Short, friendly, signs off 'Cheers, Rick'.",
    signature: "Rick Mok\n+852 9123 4567",
  });
  mockPrisma.emailDraft.create.mockImplementation(async ({ data }) => ({
    id: "draft-1",
    ...data,
    createdAt: new Date("2026-10-16T02:00:00Z"),
  }));
});

describe("draftEmail", () => {
  it("writes in the person's voice with their own examples in the same language, and keeps the draft", async () => {
    const chat = fakeChat({ subject: "Quote", body: "Hi Peter,\nThe quote went out last Friday.\nCheers,\nRick Mok\n+852 9123 4567" });

    const draft = await service.draftEmail(
      access,
      { purpose: "follow_up", recipient: "peter@abc.com", keyPoints: "quote went out last Friday", language: "auto" },
      { chat },
    );

    const prompt = chat.complete.mock.calls[0][0][1].content as string;
    expect(prompt).toContain("STYLE: Short, friendly");
    expect(prompt).toContain("Thanks for the update");
    expect(prompt).not.toContain("會議記錄");
    expect(draft).toMatchObject({ subject: "Quote", language: "en", flags: [] });
    expect(mockPrisma.emailDraft.create.mock.calls[0][0].data).toMatchObject({
      workspaceId: "ws-1",
      userId: "u-1",
      purpose: "follow_up",
    });
  });

  it("flags a fact the person never gave, without changing the draft", async () => {
    const chat = fakeChat({ subject: "Delivery", body: "We will deliver on 30 Nov for HK$5,000." });

    const draft = await service.draftEmail(
      access,
      { purpose: "update", keyPoints: "tell them we can deliver", language: "en" },
      { chat },
    );

    expect(draft.body).toBe("We will deliver on 30 Nov for HK$5,000.");
    expect(draft.flags.map((flag) => flag.kind)).toEqual(["money", "date"]);
  });

  it("writes Chinese drafts in Traditional characters", async () => {
    const chat = fakeChat({ subject: "报价", body: "各位好，报价已经发出。" });
    const draft = await service.draftEmail(
      access,
      { purpose: "update", keyPoints: "報價已經發出", language: "auto" },
      { chat },
    );
    expect(draft.language).toBe("zh-Hant");
    expect(draft.subject).toBe("報價");
    expect(draft.body).toBe("各位好，報價已經發出。");
  });

  it("reads task facts only from an official task in the caller's workspace", async () => {
    mockPrisma.task.findFirst.mockResolvedValue(null);
    await expect(
      service.draftEmail(access, { purpose: "update", keyPoints: "x", taskId: "t-other", language: "en" }, { chat: fakeChat({}) }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mockPrisma.task.findFirst.mock.calls[0][0].where).toMatchObject({ id: "t-other", workspaceId: "ws-1" });
  });

  it("treats the task's own facts as given", async () => {
    mockPrisma.task.findFirst.mockResolvedValue({
      title: "ABC quotation",
      description: null,
      dueDate: new Date("2026-10-23T00:00:00Z"),
      project: { name: "Sales" },
      status: { label: "In progress", category: "open" },
      comments: [],
    });
    const chat = fakeChat({ subject: "ABC", body: "The quotation is due 2026-10-23." });
    const draft = await service.draftEmail(
      access,
      { purpose: "update", keyPoints: "update on the quotation", taskId: "t1", language: "en" },
      { chat },
    );
    expect(draft.flags).toEqual([]);
  });
});

describe("writing style", () => {
  it("is read and written per person", async () => {
    mockPrisma.writingStyle.upsert.mockResolvedValue({});
    await service.saveWritingStyle("u-1", { signature: "Rick" });
    expect(mockPrisma.writingStyle.upsert.mock.calls[0][0]).toMatchObject({
      where: { userId: "u-1" },
      update: { signature: "Rick" },
    });
  });

  it("needs at least two samples before describing a tone", async () => {
    mockPrisma.writingStyle.findUnique.mockResolvedValue({ samples: ["only one"], profile: null, signature: null });
    await expect(service.deriveStyleProfile("u-1", { chat: fakeChat({ profile: "x" }) })).rejects.toMatchObject({
      status: 422,
    });
  });
});

describe("drafts are private", () => {
  it("lists and deletes only the caller's own drafts", async () => {
    mockPrisma.emailDraft.findMany.mockResolvedValue([]);
    mockPrisma.emailDraft.deleteMany.mockResolvedValue({ count: 0 });

    await service.listEmailDrafts(access);
    expect(mockPrisma.emailDraft.findMany.mock.calls[0][0].where).toEqual({ workspaceId: "ws-1", userId: "u-1" });

    expect(await service.deleteEmailDraft(access, "draft-x")).toBe(false);
    expect(mockPrisma.emailDraft.deleteMany.mock.calls[0][0].where).toEqual({
      id: "draft-x",
      workspaceId: "ws-1",
      userId: "u-1",
    });
  });
});
