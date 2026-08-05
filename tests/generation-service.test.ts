import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => {
  const tx = {
    milestone: { create: vi.fn() },
    task: { create: vi.fn() },
    projectRisk: { create: vi.fn() },
    taskDependency: { create: vi.fn() },
    generationRun: { update: vi.fn() },
  };
  const prisma = {
    document: { findMany: vi.fn() },
    generationRun: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return {
    tx,
    prisma,
    selectPlanContext: vi.fn(),
    buildLabelledContext: vi.fn(),
    getChatProvider: vi.fn(),
    getEmbeddingProvider: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: fakes.prisma }));
vi.mock("@/lib/providers", () => ({
  getChatProvider: fakes.getChatProvider,
  getEmbeddingProvider: fakes.getEmbeddingProvider,
}));
vi.mock("@/lib/generation/context", () => ({
  selectPlanContext: fakes.selectPlanContext,
  buildLabelledContext: fakes.buildLabelledContext,
}));

import {
  generateProjectPlan,
  GenerationRequestError,
  sanitizeReviewSummary,
} from "@/lib/generation/service";

const chunk = {
  id: "chunk-real-id",
  documentId: "doc-1",
  filename: "requirements.md",
  content: "Build the API before UAT.",
  chunkIndex: 0,
  pageNumber: 2,
  sectionTitle: "Delivery",
};

const sourceLabels = [
  {
    label: "S1",
    chunkId: chunk.id,
    documentId: chunk.documentId,
    filename: chunk.filename,
    pageNumber: chunk.pageNumber,
    sectionTitle: chunk.sectionTitle,
  },
];

const validOutput = JSON.stringify({
  tasks: [
    {
      ref: "T1",
      title: "Build API",
      citations: [{ sourceId: "S1", quote: "Build the API" }],
    },
  ],
});

function chatWith(...outputs: string[]) {
  return {
    modelName: "fake/project-planner",
    complete: vi.fn().mockImplementation(async () => outputs.shift() ?? validOutput),
  };
}

const embeddings = {
  modelName: "fake/embeddings",
  dimensions: 1536,
  embed: vi.fn(),
};

function setupBase() {
  fakes.prisma.document.findMany.mockResolvedValue([{ id: "doc-1" }]);
  fakes.prisma.generationRun.findFirst.mockResolvedValue(null);
  fakes.prisma.generationRun.create.mockResolvedValue({ id: "run-1" });
  fakes.prisma.generationRun.update.mockResolvedValue({ id: "run-1" });
  fakes.selectPlanContext.mockResolvedValue([chunk]);
  fakes.buildLabelledContext.mockReturnValue({
    chunks: [chunk],
    contextBlock: "[S1] (file: requirements.md)\nBuild the API before UAT.",
    sourceMap: new Map([["S1", chunk]]),
    sourceLabels,
  });
  fakes.tx.task.create.mockResolvedValue({ id: "task-1" });
  fakes.tx.generationRun.update.mockResolvedValue({
    id: "run-1",
    status: "draft",
    createdAt: new Date(),
    latencyMs: 5,
    _count: { tasks: 1, milestones: 0, risks: 0, taskDependencies: 0 },
  });
  fakes.prisma.$transaction.mockImplementation(
    async (operation: (tx: typeof fakes.tx) => unknown) => operation(fakes.tx),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setupBase();
});

describe("generateProjectPlan audit and isolation", () => {
  it("scopes selected documents and persists an opaque source map with the draft", async () => {
    const chat = chatWith(validOutput);
    const result = await generateProjectPlan(
      {
        workspaceId: "workspace-1",
        projectId: "project-1",
        userId: "user-1",
        documentIds: ["doc-1"],
      },
      { chat, embeddings },
    );

    expect(result.status).toBe("draft");
    expect(fakes.prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ["doc-1"] },
          workspaceId: "workspace-1",
          projectId: "project-1",
          status: "ready",
        },
      }),
    );
    expect(fakes.prisma.generationRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "processing",
          workspaceId: "workspace-1",
          projectId: "project-1",
          createdBy: "user-1",
        }),
      }),
    );
    const persisted = fakes.tx.generationRun.update.mock.calls[0][0].data;
    expect(persisted.status).toBe("draft");
    expect(persisted.selectedContextIds).toEqual({
      documentIds: ["doc-1"],
      sourceLabels,
    });
    expect(JSON.stringify(persisted.validatedOutput)).toContain("S1");
    expect(persisted.validatedOutput.sourceLabels[0]).toEqual({
      label: "S1",
      filename: "requirements.md",
      pageNumber: 2,
      sectionTitle: "Delivery",
    });
    expect(JSON.stringify(chat.complete.mock.calls[0][0])).not.toContain(
      "chunk-real-id",
    );
  });

  it("strips audit-only IDs from existing validated output before Review UI", () => {
    const safe = sanitizeReviewSummary({
      scopeStatements: [
        {
          text: "Scope",
          citations: [
            {
              sourceId: "S1",
              excerpt: "Evidence",
              chunkId: "chunk-secret",
            },
          ],
        },
      ],
      sourceLabels: [
        {
          label: "S1",
          chunkId: "chunk-secret",
          documentId: "document-secret",
          filename: "requirements.md",
          pageNumber: 2,
          sectionTitle: "Delivery",
        },
      ],
      warnings: ["warning"],
      tasks: [{ id: "task-secret" }],
    });

    expect(safe).toEqual({
      scopeStatements: [
        {
          text: "Scope",
          citations: [{ sourceId: "S1", excerpt: "Evidence" }],
        },
      ],
      deliverables: [],
      acceptanceCriteria: [],
      warnings: ["warning"],
      sourceLabels: [
        {
          label: "S1",
          filename: "requirements.md",
          pageNumber: 2,
          sectionTitle: "Delivery",
        },
      ],
    });
    expect(JSON.stringify(safe)).not.toMatch(/chunk-secret|document-secret|task-secret/);
  });

  it("rejects a document that is not ready in the caller's project before creating a run", async () => {
    fakes.prisma.document.findMany.mockResolvedValue([]);
    await expect(
      generateProjectPlan(
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          userId: "user-1",
          documentIds: ["foreign-doc"],
        },
        { chat: chatWith(validOutput), embeddings },
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(fakes.prisma.generationRun.create).not.toHaveBeenCalled();
  });

  it("blocks a second processing or draft plan", async () => {
    fakes.prisma.generationRun.findFirst.mockResolvedValue({ id: "active-run" });
    await expect(
      generateProjectPlan(
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          userId: "user-1",
          documentIds: ["doc-1"],
        },
        { chat: chatWith(validOutput), embeddings },
      ),
    ).rejects.toBeInstanceOf(GenerationRequestError);
    expect(fakes.prisma.generationRun.create).not.toHaveBeenCalled();
  });

  it("retains both malformed attempts and marks the processing run failed", async () => {
    const chat = chatWith("not json", "{still-not-valid");
    await expect(
      generateProjectPlan(
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          userId: "user-1",
          documentIds: ["doc-1"],
        },
        { chat, embeddings },
      ),
    ).rejects.toMatchObject({ status: 422 });

    expect(chat.complete).toHaveBeenCalledTimes(2);
    const failure = fakes.prisma.generationRun.update.mock.calls.at(-1)?.[0].data;
    expect(failure.status).toBe("failed");
    expect(JSON.parse(failure.rawOutput).attempts).toEqual([
      "not json",
      "{still-not-valid",
    ]);
  });

  it("audits provider factory failures after the processing row exists", async () => {
    fakes.getChatProvider.mockImplementation(() => {
      throw new Error("OPENROUTER_API_KEY is missing");
    });

    await expect(
      generateProjectPlan({
        workspaceId: "workspace-1",
        projectId: "project-1",
        userId: "user-1",
        documentIds: ["doc-1"],
      }),
    ).rejects.toThrow(/OPENROUTER_API_KEY/);

    expect(fakes.prisma.generationRun.create).toHaveBeenCalled();
    expect(fakes.prisma.generationRun.update).toHaveBeenLastCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({
        status: "failed",
        errorMessage: expect.stringContaining("OPENROUTER_API_KEY"),
      }),
    });
  });
});
