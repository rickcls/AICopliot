import { beforeEach, describe, expect, it, vi } from "vitest";
import { inVisibleProjects, visibleProjectWhere } from "@/lib/pm/visibility";

const tx = {
  project: { create: vi.fn() },
  projectTaskStatus: { createMany: vi.fn() },
};
const mockPrisma = {
  project: { findFirst: vi.fn() },
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("server-only", () => ({}));

const { getOrCreatePersonalProject, personalProjectName } = await import(
  "@/lib/pm/personal-project"
);

const user = { id: "u1", name: "Rick", email: "rick@example.com" };
const uniqueViolation = Object.assign(new Error("unique"), { code: "P2002" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("visibleProjectWhere", () => {
  it("shows ordinary projects and only the viewer's own personal one", () => {
    expect(visibleProjectWhere("w1", "u1")).toEqual({
      workspaceId: "w1",
      OR: [{ personalOwnerId: null }, { personalOwnerId: "u1" }],
    });
  });

  it("narrows records through an AND, so an existing OR survives", () => {
    const where = { workspaceId: "w1", OR: [{ a: 1 }, { b: 2 }] };
    expect(inVisibleProjects("w1", "u1", where)).toEqual({
      AND: [where, { project: visibleProjectWhere("w1", "u1") }],
    });
  });
});

describe("personalProjectName", () => {
  it("is written in the viewer's language", () => {
    expect(personalProjectName("Rick", user.email, "zh-Hant")).toBe("Rick的個人工作");
    expect(personalProjectName("Rick", user.email, "en")).toBe("Rick's work");
  });

  it("falls back to the email's local part without a name", () => {
    expect(personalProjectName(null, "ada@example.com", "en")).toBe("ada's work");
  });
});

describe("getOrCreatePersonalProject", () => {
  it("returns the existing one without writing", async () => {
    mockPrisma.project.findFirst.mockResolvedValue({ id: "p1", name: "Mine" });

    expect(await getOrCreatePersonalProject("w1", user, "en")).toEqual({ id: "p1", name: "Mine" });
    expect(mockPrisma.project.findFirst.mock.calls[0][0].where).toEqual({
      workspaceId: "w1",
      personalOwnerId: "u1",
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("creates it with the default columns on first use", async () => {
    mockPrisma.project.findFirst.mockResolvedValue(null);
    tx.project.create.mockResolvedValue({ id: "p-new", name: "Rick's work" });

    expect(await getOrCreatePersonalProject("w1", user, "en")).toEqual({
      id: "p-new",
      name: "Rick's work",
    });
    expect(tx.project.create.mock.calls[0][0].data).toEqual({
      workspaceId: "w1",
      name: "Rick's work",
      personalOwnerId: "u1",
    });
    expect(tx.projectTaskStatus.createMany).toHaveBeenCalledTimes(1);
  });

  it("re-reads instead of failing when a concurrent request created it first", async () => {
    mockPrisma.project.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "p-raced", name: "Rick's work" });
    tx.project.create.mockRejectedValueOnce(uniqueViolation);

    expect(await getOrCreatePersonalProject("w1", user, "en")).toEqual({
      id: "p-raced",
      name: "Rick's work",
    });
    expect(tx.project.create).toHaveBeenCalledTimes(1);
  });

  it("adds the email when the name is already taken by another project", async () => {
    mockPrisma.project.findFirst.mockResolvedValue(null);
    tx.project.create
      .mockRejectedValueOnce(uniqueViolation)
      .mockResolvedValueOnce({ id: "p2", name: "Rick's work (rick@example.com)" });

    await getOrCreatePersonalProject("w1", user, "en");

    expect(tx.project.create.mock.calls[1][0].data.name).toBe(
      "Rick's work (rick@example.com)",
    );
  });
});
