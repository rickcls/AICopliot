import { describe, expect, it } from "vitest";
import { overlapTokens, rankTaskCandidates } from "@/lib/capture/candidates";
import { pickStatusForCategory } from "@/lib/pm/status-pick";

const today = new Date("2026-10-16T00:00:00Z");
const task = (title: string, due: string | null = null, updated = "2026-10-01") => ({
  title,
  dueDate: due ? new Date(`${due}T00:00:00Z`) : null,
  updatedAt: new Date(`${updated}T00:00:00Z`),
});

describe("overlapTokens", () => {
  it("uses Chinese character pairs and Latin words of three letters or more", () => {
    expect([...overlapTokens("交月報 to ABC co")].sort()).toEqual(["abc", "交月", "月報"].sort());
  });
});

describe("rankTaskCandidates", () => {
  it("puts tasks sharing words with the note first", () => {
    const ranked = rankTaskCandidates(
      [task("準備季度預算"), task("提交月報"), task("Call ABC about contract")],
      "月報已經交咗，等緊ABC覆contract",
      today,
    );
    expect(ranked.map((row) => row.title).slice(0, 2).sort()).toEqual(
      ["Call ABC about contract", "提交月報"].sort(),
    );
    expect(ranked[2].title).toBe("準備季度預算");
  });

  it("fills the rest by nearest due date, then most recently touched", () => {
    const ranked = rankTaskCandidates(
      [task("x", null, "2026-10-10"), task("y", "2026-10-30"), task("z", "2026-10-17"), task("w", null, "2026-10-15")],
      "nothing in common",
      today,
    );
    expect(ranked.map((row) => row.title)).toEqual(["z", "y", "w", "x"]);
  });

  it("caps the list", () => {
    expect(rankTaskCandidates([task("a"), task("b"), task("c")], "", today, 2)).toHaveLength(2);
  });
});

describe("pickStatusForCategory", () => {
  const statuses = [
    { id: "done2", key: "shipped", category: "done" as const, position: 5 },
    { id: "backlog", key: "backlog", category: "open" as const, position: 0 },
    { id: "progress", key: "in_progress", category: "open" as const, position: 2 },
    { id: "done", key: "done", category: "done" as const, position: 4 },
  ];

  it("takes the first done column in board order", () => {
    expect(pickStatusForCategory(statuses, "done")?.id).toBe("done");
  });

  it("prefers In progress when work is still going", () => {
    expect(pickStatusForCategory(statuses, "open")?.id).toBe("progress");
  });

  it("returns null when the project has no blocked column", () => {
    expect(pickStatusForCategory(statuses, "blocked")).toBeNull();
  });
});
