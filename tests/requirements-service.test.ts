import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => {
  const tx = {
    requirement: { aggregate: vi.fn(), create: vi.fn(), groupBy: vi.fn() },
    generationRun: { update: vi.fn() },
  };
  const prisma = {
    document: { findMany: vi.fn() },
    generationRun: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  };
  return {
    tx,
    prisma,
    selectDocumentContext: vi.fn(),
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
  selectDocumentContext: fakes.selectDocumentContext,
  buildLabelledContext: fakes.buildLabelledContext,
}));

import { generateRequirements } from "@/lib/generation/requirements-service";
import { GenerationRequestError } from "@/lib/generation/service";
import { REQUIREMENTS_QUERIES } from "@/lib/generation/requirements-prompt";

const chunk = {
  id: "chunk-real-id",
  documentId: "doc-1",
  filename: "brief.md",
  content: "Managers approve leave requests. The portal must be secure.",
  chunkIndex: 0,
  pageNumber: 1,
  sectionTitle: "Scope",
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
  requirements: [
    {
      title: "Managers approve leave requests",
      priority: "must",
      citations: [{ sourceId: "S1", quote: "Managers approve leave requests" }],
    },
    {
      title: "The portal must be secure",
      type: "non_functional",
      confidence: "low",
      citations: [{ sourceId: "S1", quote: "The portal must be secure" }],
    },
  ],
});

function chatWith(...outputs: string[]) {
  return {
    modelName: "fake/requirements-extractor",
    complete: vi.fn().mockImplementation(async () => outputs.shift() ?? validOutput),
  };
}

const embeddings = { modelName: "fake/embeddings", dimensions: 1536, embed: vi.fn() };

const input = {
  workspaceId: "workspace-1",
  projectId: "project-1",
  userId: "user-1",
  documentIds: ["doc-1"],
};

beforeEach(() => {
  vi.clearAllMocks();
  fakes.prisma.document.findMany.mockResolvedValue([{ id: "doc-1" }]);
  fakes.prisma.generationRun.findFirst.mockResolvedValue(null);
  fakes.prisma.generationRun.create.mockResolvedValue({ id: "run-1" });
  fakes.prisma.generationRun.update.mockResolvedValue({ id: "run-1" });
  fakes.selectDocumentContext.mockResolvedValue([chunk]);
  fakes.buildLabelledContext.mockReturnValue({
    chunks: [chunk],
    contextBlock: "[S1] (file: brief.md)\n" + chunk.content,
    sourceMap: new Map([["S1", chunk]]),
    sourceLabels,
  });
  fakes.tx.requirement.aggregate.mockResolvedValue({ _max: { sequence: 7 } });
  fakes.tx.requirement.create.mockResolvedValue({ id: "requirement-1" });
  fakes.tx.generationRun.update.mockResolvedValue({
    id: "run-1",
    status: "draft",
    createdAt: new Date(),
    latencyMs: 5,
    _count: { requirements: 2 },
  });
  fakes.prisma.$transaction.mockImplementation(
    async (operation: (tx: typeof fakes.tx) => unknown) => operation(fakes.tx),
  );
});

describe("generateRequirements audit and isolation", () => {
  it("scopes selected documents to the workspace, project, and ready status", async () => {
    await generateRequirements(input, { chat: chatWith(validOutput), embeddings });

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
  });

  it("retrieves with the requirements probes rather than the planning ones", async () => {
    await generateRequirements(input, { chat: chatWith(validOutput), embeddings });

    expect(fakes.selectDocumentContext).toHaveBeenCalledWith(
      "workspace-1",
      ["doc-1"],
      embeddings,
      REQUIREMENTS_QUERIES,
    );
  });

  it("never puts a real chunk ID in the prompt", async () => {
    const chat = chatWith(validOutput);
    await generateRequirements(input, { chat, embeddings });

    const messages = chat.complete.mock.calls[0][0] as Array<{ content: string }>;
    for (const message of messages) {
      expect(message.content).not.toContain(chunk.id);
    }
  });

  it("writes every proposal as an unapproved draft on both axes", async () => {
    await generateRequirements(input, { chat: chatWith(validOutput), embeddings });

    expect(fakes.tx.requirement.create).toHaveBeenCalledTimes(2);
    for (const call of fakes.tx.requirement.create.mock.calls) {
      expect(call[0].data).toMatchObject({
        workspaceId: "workspace-1",
        projectId: "project-1",
        source: "ai_suggested",
        generationStatus: "draft",
        status: "draft",
        generationRunId: "run-1",
      });
    }
  });

  it("continues the project's sequence rather than restarting it", async () => {
    await generateRequirements(input, { chat: chatWith(validOutput), embeddings });

    const sequences = fakes.tx.requirement.create.mock.calls.map(
      (call) => call[0].data.sequence,
    );
    expect(sequences).toEqual([8, 9]);
  });

  it("resolves citations to real chunk IDs only on the server side", async () => {
    await generateRequirements(input, { chat: chatWith(validOutput), embeddings });

    const first = fakes.tx.requirement.create.mock.calls[0][0].data;
    expect(first.citations.create).toEqual([
      expect.objectContaining({
        workspaceId: "workspace-1",
        documentChunkId: chunk.id,
      }),
    ]);
  });

  it("strips the label-to-chunk map out of the reviewable run output", async () => {
    await generateRequirements(input, { chat: chatWith(validOutput), embeddings });

    const update = fakes.tx.generationRun.update.mock.calls[0][0];
    expect(update.data.status).toBe("draft");
    // sourceLabels is display metadata only. The label-to-database-ID mapping
    // stays in selectedContextIds; resolved citations keep their chunkId
    // because that is how review links a proposal back to its document.
    expect(update.data.validatedOutput.sourceLabels).toEqual([
      { label: "S1", filename: "brief.md", pageNumber: 1, sectionTitle: "Scope" },
    ]);
    for (const source of update.data.validatedOutput.sourceLabels) {
      expect(source).not.toHaveProperty("chunkId");
      expect(source).not.toHaveProperty("documentId");
    }
  });

  it("refuses a second run while one is still awaiting review", async () => {
    fakes.prisma.generationRun.findFirst.mockResolvedValue({ id: "run-0" });

    await expect(
      generateRequirements(input, { chat: chatWith(validOutput), embeddings }),
    ).rejects.toMatchObject({ status: 409 });
    expect(fakes.prisma.generationRun.create).not.toHaveBeenCalled();
  });

  it("rejects a document that is not ready or not in this project", async () => {
    fakes.prisma.document.findMany.mockResolvedValue([]);

    await expect(
      generateRequirements(input, { chat: chatWith(validOutput), embeddings }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("generateRequirements failure handling", () => {
  it("repairs malformed JSON exactly once", async () => {
    const chat = chatWith("not json at all", validOutput);
    await generateRequirements(input, { chat, embeddings });

    expect(chat.complete).toHaveBeenCalledTimes(2);
    expect(fakes.tx.requirement.create).toHaveBeenCalledTimes(2);
  });

  it("leaves an auditable failed run when the model never complies", async () => {
    const chat = chatWith("nope", "still nope");

    await expect(
      generateRequirements(input, { chat, embeddings }),
    ).rejects.toBeInstanceOf(GenerationRequestError);

    const failure = fakes.prisma.generationRun.update.mock.calls.at(-1)?.[0];
    expect(failure.data.status).toBe("failed");
    // Both raw attempts are retained verbatim so the failure is inspectable.
    expect(failure.data.rawOutput).toContain("still nope");
  });

  it("records the run before the provider is resolved, so a missing key is auditable", async () => {
    fakes.getChatProvider.mockImplementation(() => {
      throw new Error("OPENROUTER_API_KEY is not set");
    });

    await expect(generateRequirements(input)).rejects.toThrow(
      "OPENROUTER_API_KEY is not set",
    );

    expect(fakes.prisma.generationRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "requirements",
          model: "unavailable",
          status: "processing",
        }),
      }),
    );
    expect(fakes.prisma.generationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
  });

  it("fails the run when nothing survives citation validation", async () => {
    const uncited = JSON.stringify({
      requirements: [{ title: "Invented scope", citations: [] }],
    });

    await expect(
      generateRequirements(input, { chat: chatWith(uncited, uncited), embeddings }),
    ).rejects.toMatchObject({ status: 422 });
    expect(fakes.tx.requirement.create).not.toHaveBeenCalled();
  });
});
