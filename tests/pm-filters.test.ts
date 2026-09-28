import { describe, expect, it } from "vitest";
import {
  EMPTY_REQUIREMENT_FILTER,
  EMPTY_TASK_FILTER,
  isTaskFilterActive,
  matchesQuery,
  parseRegisterFilter,
  parseTaskQuickFilter,
  requirementMatches,
  riskExposure,
  sortRisks,
  taskMatches,
  type FilterableRequirement,
  type FilterableTask,
} from "@/lib/pm/filters";

const NOW = new Date("2026-09-24T15:00:00Z");
const ME = "user-1";
const context = { now: NOW, currentUserId: ME };

function task(overrides: Partial<FilterableTask> = {}): FilterableTask {
  return {
    title: "Configure SSO",
    description: null,
    status: { category: "open" },
    priority: "medium",
    assigneeId: null,
    milestoneId: null,
    dueDate: null,
    ...overrides,
  };
}

describe("matchesQuery", () => {
  it("matches everything when the query is blank", () => {
    expect(matchesQuery("   ", ["anything"])).toBe(true);
  });

  it("requires every term, across any field, case-insensitively", () => {
    expect(matchesQuery("sso AZURE", ["Configure SSO", "via Azure AD"])).toBe(true);
    expect(matchesQuery("sso okta", ["Configure SSO", "via Azure AD"])).toBe(false);
  });

  it("ignores null fields", () => {
    expect(matchesQuery("sso", [null, undefined, "SSO"])).toBe(true);
  });
});

describe("taskMatches", () => {
  it("passes every task through the empty filter", () => {
    expect(isTaskFilterActive(EMPTY_TASK_FILTER)).toBe(false);
    expect(taskMatches(task(), EMPTY_TASK_FILTER, context)).toBe(true);
  });

  it("treats a task due today as due soon, not overdue — the UTC-day rule", () => {
    const dueToday = task({ dueDate: "2026-09-24T00:00:00.000Z" });
    expect(
      taskMatches(dueToday, { ...EMPTY_TASK_FILTER, quick: "overdue" }, context),
    ).toBe(false);
    expect(
      taskMatches(dueToday, { ...EMPTY_TASK_FILTER, quick: "due_soon" }, context),
    ).toBe(true);
  });

  it("never calls finished work overdue", () => {
    const doneLate = task({
      dueDate: "2026-09-01T00:00:00.000Z",
      status: { category: "done" },
    });
    expect(
      taskMatches(doneLate, { ...EMPTY_TASK_FILTER, quick: "overdue" }, context),
    ).toBe(false);
  });

  it("filters blocked by category, not by label", () => {
    const blocked = task({ status: { category: "blocked" } });
    expect(
      taskMatches(blocked, { ...EMPTY_TASK_FILTER, quick: "blocked" }, context),
    ).toBe(true);
    expect(
      taskMatches(task(), { ...EMPTY_TASK_FILTER, quick: "blocked" }, context),
    ).toBe(false);
  });

  it("separates mine from unassigned, and excludes finished unassigned work", () => {
    const filterMine = { ...EMPTY_TASK_FILTER, quick: "mine" as const };
    const filterUnassigned = { ...EMPTY_TASK_FILTER, quick: "unassigned" as const };
    expect(taskMatches(task({ assigneeId: ME }), filterMine, context)).toBe(true);
    expect(taskMatches(task({ assigneeId: "other" }), filterMine, context)).toBe(false);
    expect(taskMatches(task(), filterUnassigned, context)).toBe(true);
    expect(
      taskMatches(task({ status: { category: "done" } }), filterUnassigned, context),
    ).toBe(false);
  });

  it("distinguishes 'any milestone' from 'no milestone'", () => {
    const linked = task({ milestoneId: "m1" });
    expect(taskMatches(linked, { ...EMPTY_TASK_FILTER, milestoneId: "none" }, context)).toBe(false);
    expect(taskMatches(task(), { ...EMPTY_TASK_FILTER, milestoneId: "none" }, context)).toBe(true);
    expect(taskMatches(linked, { ...EMPTY_TASK_FILTER, milestoneId: "m1" }, context)).toBe(true);
    expect(taskMatches(linked, { ...EMPTY_TASK_FILTER, milestoneId: "m2" }, context)).toBe(false);
  });

  it("combines the quick filter, priority, and text query with AND", () => {
    const urgent = task({ priority: "urgent", status: { category: "blocked" } });
    const filter = {
      ...EMPTY_TASK_FILTER,
      quick: "blocked" as const,
      priority: "urgent",
      query: "sso",
    };
    expect(taskMatches(urgent, filter, context)).toBe(true);
    expect(taskMatches(urgent, { ...filter, query: "billing" }, context)).toBe(false);
  });
});

describe("parseTaskQuickFilter", () => {
  it("accepts known values and rejects anything else", () => {
    expect(parseTaskQuickFilter("overdue")).toBe("overdue");
    expect(parseTaskQuickFilter("drop table")).toBeNull();
    expect(parseTaskQuickFilter(["overdue"])).toBeNull();
    expect(parseTaskQuickFilter(undefined)).toBeNull();
  });
});

describe("parseRegisterFilter", () => {
  it("accepts gaps and lifecycle statuses, and falls back to all", () => {
    expect(parseRegisterFilter("gaps")).toBe("gaps");
    expect(parseRegisterFilter("needs_clarification")).toBe("needs_clarification");
    expect(parseRegisterFilter("baselined")).toBe("all");
    expect(parseRegisterFilter(undefined)).toBe("all");
  });
});

describe("requirementMatches", () => {
  const requirement: FilterableRequirement = {
    sequence: 7,
    title: "Single sign-on",
    description: "Staff log in with corporate credentials",
    acceptanceCriteria: null,
    stakeholder: "IT Security",
    type: "functional",
    priority: "must",
    confidence: "high",
  };

  it("finds a requirement by its rendered code", () => {
    expect(
      requirementMatches(requirement, { ...EMPTY_REQUIREMENT_FILTER, query: "req-007" }),
    ).toBe(true);
  });

  it("searches the stakeholder", () => {
    expect(
      requirementMatches(requirement, { ...EMPTY_REQUIREMENT_FILTER, query: "security" }),
    ).toBe(true);
  });

  it("narrows by type, priority, and confidence", () => {
    expect(
      requirementMatches(requirement, { ...EMPTY_REQUIREMENT_FILTER, priority: "should" }),
    ).toBe(false);
    expect(
      requirementMatches(requirement, {
        ...EMPTY_REQUIREMENT_FILTER,
        type: "functional",
        priority: "must",
        confidence: "high",
      }),
    ).toBe(true);
  });
});

describe("risk ordering", () => {
  it("scores exposure on the existing scales", () => {
    expect(riskExposure({ impact: "high", likelihood: "high" })).toBe(9);
    expect(riskExposure({ impact: "low", likelihood: "medium" })).toBe(2);
  });

  it("sorts by exposure, breaking ties by impact, without mutating input", () => {
    const risks = [
      { id: "nuisance", impact: "low" as const, likelihood: "high" as const },
      { id: "worst", impact: "high" as const, likelihood: "high" as const },
      { id: "catastrophe", impact: "high" as const, likelihood: "low" as const },
    ];
    expect(sortRisks(risks, "exposure").map((risk) => risk.id)).toEqual([
      "worst",
      "catastrophe",
      "nuisance",
    ]);
    expect(risks[0].id).toBe("nuisance");
    expect(sortRisks(risks, "recent")).toBe(risks);
  });
});
