import { describe, expect, it } from "vitest";
import {
  buildDeterministicStatusReport,
  buildReportGroundingSources,
  hasReportableData,
  type ReportDependencyInput,
  type ReportMilestoneInput,
  type ReportRiskInput,
  type ReportTaskInput,
  type StatusReportSourceData,
} from "@/lib/reports/status-report";

const NOW = new Date("2026-08-05T18:30:00.000Z");

function task(overrides: Partial<ReportTaskInput> = {}): ReportTaskInput {
  return {
    id: "task-1",
    title: "Ship release",
    description: null,
    status: "todo",
    priority: "medium",
    dueDate: null,
    completedAt: null,
    assignee: null,
    milestone: null,
    ...overrides,
  };
}

function milestone(
  overrides: Partial<ReportMilestoneInput> = {},
): ReportMilestoneInput {
  return {
    id: "milestone-1",
    title: "Launch",
    description: null,
    status: "on_track",
    targetDate: null,
    completedAt: null,
    ...overrides,
  };
}

function risk(overrides: Partial<ReportRiskInput> = {}): ReportRiskInput {
  return {
    id: "risk-1",
    description: "Vendor delay",
    impact: "medium",
    likelihood: "medium",
    mitigation: null,
    status: "open",
    milestone: null,
    ...overrides,
  };
}

function dependency(
  overrides: Partial<ReportDependencyInput> = {},
): ReportDependencyInput {
  return {
    id: "dependency-1",
    task: { id: "task-1", title: "Run UAT", status: "todo" },
    dependsOnTask: {
      id: "task-2",
      title: "Security approval",
      status: "in_progress",
    },
    ...overrides,
  };
}

function data(
  overrides: Partial<StatusReportSourceData> = {},
): StatusReportSourceData {
  return {
    project: { id: "project-1", name: "Launch" },
    tasks: [],
    milestones: [],
    risks: [],
    dependencies: [],
    ...overrides,
  };
}

describe("weekly UTC windows", () => {
  it("uses seven calendar days ending today and the following seven days", () => {
    const report = buildDeterministicStatusReport(
      data({
        tasks: [
          task({
            id: "completed-start",
            title: "Window start",
            status: "done",
            completedAt: new Date("2026-07-30T00:00:00.000Z"),
          }),
          task({
            id: "completed-before",
            title: "Before window",
            status: "done",
            completedAt: new Date("2026-07-29T23:59:59.999Z"),
          }),
          task({
            id: "completed-end",
            title: "Today",
            status: "done",
            completedAt: new Date("2026-08-05T23:59:59.999Z"),
          }),
          task({ id: "next-start", title: "Tomorrow", dueDate: new Date("2026-08-06") }),
          task({ id: "next-end", title: "Day seven", dueDate: new Date("2026-08-12") }),
          task({ id: "after-next", title: "Day eight", dueDate: new Date("2026-08-13") }),
        ],
      }),
      NOW,
    );

    expect(report.period).toEqual({
      start: "2026-07-30",
      end: "2026-08-05",
      upcomingStart: "2026-08-06",
      upcomingEnd: "2026-08-12",
    });
    expect(report.sections.completed.map((item) => item.id)).toEqual([
      "completed-start",
      "completed-end",
    ]);
    expect(report.sections.upcoming.map((item) => item.id)).toEqual([
      "next-start",
      "next-end",
    ]);
  });
});

describe("project health", () => {
  it("gives red precedence to blockers and overdue work", () => {
    const report = buildDeterministicStatusReport(
      data({
        tasks: [task({ status: "blocked", dueDate: new Date("2026-08-10") })],
        milestones: [milestone({ status: "at_risk" })],
      }),
      NOW,
    );
    expect(report.health).toBe("red");
  });

  it("marks an open high/high risk red but not a monitoring high/high risk", () => {
    const open = buildDeterministicStatusReport(
      data({ risks: [risk({ impact: "high", likelihood: "high", status: "open" })] }),
      NOW,
    );
    const monitoring = buildDeterministicStatusReport(
      data({
        risks: [risk({ impact: "high", likelihood: "high", status: "monitoring" })],
      }),
      NOW,
    );
    expect(open.health).toBe("red");
    expect(monitoring.health).toBe("green");
    expect(monitoring.sections.risks).toHaveLength(1);
  });

  it("uses amber for at-risk milestones, due-soon work, or one high open risk axis", () => {
    const reports = [
      data({ milestones: [milestone({ status: "at_risk" })] }),
      data({ tasks: [task({ dueDate: new Date("2026-08-10") })] }),
      data({ risks: [risk({ impact: "high", likelihood: "medium" })] }),
    ].map((value) => buildDeterministicStatusReport(value, NOW));
    expect(reports.map((report) => report.health)).toEqual([
      "amber",
      "amber",
      "amber",
    ]);
  });

  it("is green when no red or amber condition exists", () => {
    expect(
      buildDeterministicStatusReport(data({ tasks: [task()] }), NOW).health,
    ).toBe("green");
  });
});

describe("deterministic sections and source snapshot", () => {
  it("counts unfinished prerequisites exactly and retains them as sources", () => {
    const report = buildDeterministicStatusReport(
      data({
        tasks: [task()],
        dependencies: [
          dependency(),
          dependency({
            id: "dependency-done",
            task: { id: "task-3", title: "Deploy", status: "todo" },
            dependsOnTask: { id: "task-4", title: "Build", status: "done" },
          }),
        ],
      }),
      NOW,
    );

    expect(report.counts.dependencyBlockers).toBe(1);
    expect(report.sections.dependencyBlockers).toEqual([
      expect.objectContaining({
        id: "dependency-1",
        title: "Run UAT depends on Security approval",
      }),
    ]);

    const sources = buildReportGroundingSources(report);
    expect(sources[0]).toMatchObject({
      kind: "project_snapshot",
      snapshot: {
        health: "green",
        dependencyBlockers: 1,
      },
    });
    expect(sources[0].content).toContain("1 dependency blockers");
    expect(sources.some((source) => source.kind === "dependency")).toBe(true);
  });

  it("detects a genuinely empty report before a model is needed", () => {
    expect(hasReportableData(data())).toBe(false);
    expect(hasReportableData(data({ risks: [risk()] }))).toBe(true);
  });
});
