import { describe, expect, it } from "vitest";
import {
  createMilestoneSchema,
  createRiskSchema,
  createTaskDependencySchema,
  createTaskSchema,
  updateMilestoneSchema,
  updateRiskSchema,
  updateTaskSchema,
} from "@/lib/schemas";

describe("task input", () => {
  it("trims the title and applies defaults", () => {
    const result = createTaskSchema.parse({ title: "  Patch the gateway  " });

    expect(result).toMatchObject({
      title: "Patch the gateway",
      status: "backlog",
      priority: "medium",
    });
  });

  it("rejects a blank title", () => {
    expect(createTaskSchema.safeParse({ title: "   " }).success).toBe(false);
  });

  it("rejects an unknown status or priority", () => {
    expect(
      createTaskSchema.safeParse({ title: "x", status: "archived" }).success,
    ).toBe(false);
    expect(
      createTaskSchema.safeParse({ title: "x", priority: "critical" }).success,
    ).toBe(false);
  });

  it("rejects a negative estimate", () => {
    expect(
      createTaskSchema.safeParse({ title: "x", estimatedHours: -1 }).success,
    ).toBe(false);
  });

  it("accepts a zero estimate", () => {
    expect(
      createTaskSchema.parse({ title: "x", estimatedHours: 0 }).estimatedHours,
    ).toBe(0);
  });

  it("coerces a date input to UTC midnight", () => {
    const result = createTaskSchema.parse({ title: "x", dueDate: "2026-08-11" });

    expect(result.dueDate?.toISOString()).toBe("2026-08-11T00:00:00.000Z");
  });

  it("treats an empty date string as clearing the date", () => {
    expect(createTaskSchema.parse({ title: "x", dueDate: "" }).dueDate).toBeNull();
    expect(
      createTaskSchema.parse({ title: "x", dueDate: null }).dueDate,
    ).toBeNull();
  });

  it("rejects an unparseable date", () => {
    expect(
      createTaskSchema.safeParse({ title: "x", dueDate: "not-a-date" }).success,
    ).toBe(false);
  });

  it("normalises an empty description to null", () => {
    expect(
      createTaskSchema.parse({ title: "x", description: "   " }).description,
    ).toBeNull();
  });

  it("leaves an omitted description undefined, so a PATCH cannot erase it", () => {
    // The distinction that matters: absent means "leave alone", empty means
    // "clear". Collapsing them wipes text the caller never mentioned.
    expect(updateTaskSchema.parse({ status: "done" }).description).toBeUndefined();
    expect(updateTaskSchema.parse({ description: "" }).description).toBeNull();
  });
});

describe("task scheduling dates", () => {
  it("accepts a start date on or before the due date", () => {
    expect(
      createTaskSchema.safeParse({
        title: "x",
        startDate: "2026-08-01",
        dueDate: "2026-08-10",
      }).success,
    ).toBe(true);
    expect(
      createTaskSchema.safeParse({
        title: "x",
        startDate: "2026-08-10",
        dueDate: "2026-08-10",
      }).success,
    ).toBe(true);
  });

  it("rejects a start date after the due date", () => {
    const result = createTaskSchema.safeParse({
      title: "x",
      startDate: "2026-08-11",
      dueDate: "2026-08-10",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/on or before/i);
  });

  it("rejects an inverted pair on update too", () => {
    expect(
      updateTaskSchema.safeParse({
        startDate: "2026-09-01",
        dueDate: "2026-08-01",
      }).success,
    ).toBe(false);
  });

  it("allows either date alone, since the pair is checked against the stored row", () => {
    expect(updateTaskSchema.safeParse({ startDate: "2026-08-01" }).success).toBe(
      true,
    );
    expect(updateTaskSchema.safeParse({ dueDate: "2026-08-01" }).success).toBe(
      true,
    );
  });

  it("allows a task with no dates at all", () => {
    expect(createTaskSchema.safeParse({ title: "x" }).success).toBe(true);
  });
});

describe("update inputs require a field", () => {
  it("rejects an empty task update", () => {
    expect(updateTaskSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an empty milestone update", () => {
    expect(updateMilestoneSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an empty risk update", () => {
    expect(updateRiskSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a single-field status change", () => {
    expect(updateTaskSchema.parse({ status: "done" })).toEqual({
      status: "done",
    });
  });

  it("accepts explicitly clearing the assignee", () => {
    expect(updateTaskSchema.parse({ assigneeId: null })).toEqual({
      assigneeId: null,
    });
  });

  it("accepts assigning or clearing a project milestone", () => {
    expect(updateTaskSchema.parse({ milestoneId: "milestone-1" })).toEqual({
      milestoneId: "milestone-1",
    });
    expect(updateTaskSchema.parse({ milestoneId: null })).toEqual({
      milestoneId: null,
    });
  });
});

describe("milestone input", () => {
  it("defaults a new milestone to not_started", () => {
    expect(createMilestoneSchema.parse({ title: "UAT sign-off" }).status).toBe(
      "not_started",
    );
  });

  it("rejects an unknown milestone status", () => {
    expect(
      createMilestoneSchema.safeParse({ title: "x", status: "late" }).success,
    ).toBe(false);
  });
});

describe("risk input", () => {
  it("defaults impact, likelihood, and status", () => {
    expect(createRiskSchema.parse({ description: "Untested failover" })).toMatchObject(
      { impact: "medium", likelihood: "medium", status: "open" },
    );
  });

  it("rejects a blank description", () => {
    expect(createRiskSchema.safeParse({ description: "  " }).success).toBe(false);
  });

  it("rejects an out-of-scale impact or likelihood", () => {
    expect(
      createRiskSchema.safeParse({ description: "x", impact: "critical" })
        .success,
    ).toBe(false);
    expect(
      createRiskSchema.safeParse({ description: "x", likelihood: "certain" })
        .success,
    ).toBe(false);
  });

  it("rejects an unknown risk status", () => {
    expect(
      createRiskSchema.safeParse({ description: "x", status: "closed" }).success,
    ).toBe(false);
  });

  it("accepts assigning and clearing a project milestone", () => {
    expect(
      createRiskSchema.parse({
        description: "Untested failover",
        milestoneId: "milestone-1",
      }).milestoneId,
    ).toBe("milestone-1");
    expect(updateRiskSchema.parse({ milestoneId: null })).toEqual({
      milestoneId: null,
    });
  });
});

describe("dependency input", () => {
  it("requires a target task", () => {
    expect(createTaskDependencySchema.safeParse({}).success).toBe(false);
    expect(
      createTaskDependencySchema.safeParse({ dependsOnTaskId: "" }).success,
    ).toBe(false);
  });
});
