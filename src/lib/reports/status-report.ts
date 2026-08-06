import {
  DONE_TASK_CATEGORY,
  isDueWithinDays,
  isMilestoneOpen,
  isOverdue,
  isTaskOpen,
  startOfUtcDay,
} from "@/lib/pm/rules";
import type { ProjectGroundingSource } from "@/lib/rag/project-context";
import type { ProjectCitation } from "@/lib/schemas";

const MS_PER_DAY = 86_400_000;

export type ProjectHealth = "green" | "amber" | "red";
export type StatusReportItemKind = "task" | "milestone" | "risk" | "dependency";

export interface ReportTaskStatus {
  key: string;
  label: string;
  category: "open" | "blocked" | "done";
}

export interface ReportTaskInput {
  id: string;
  title: string;
  description: string | null;
  status: ReportTaskStatus;
  priority: "low" | "medium" | "high" | "urgent";
  dueDate: Date | null;
  completedAt: Date | null;
  assignee: { name: string | null; email: string } | null;
  milestone: { title: string } | null;
}

export interface ReportMilestoneInput {
  id: string;
  title: string;
  description: string | null;
  status: "not_started" | "on_track" | "at_risk" | "blocked" | "completed";
  targetDate: Date | null;
  completedAt: Date | null;
}

export interface ReportRiskInput {
  id: string;
  description: string;
  impact: "low" | "medium" | "high";
  likelihood: "low" | "medium" | "high";
  mitigation: string | null;
  status: "open" | "monitoring" | "mitigated" | "accepted";
  milestone: { title: string } | null;
}

export interface ReportDependencyInput {
  id: string;
  task: { id: string; title: string; status: ReportTaskInput["status"] };
  dependsOnTask: {
    id: string;
    title: string;
    status: ReportTaskInput["status"];
  };
}

export interface StatusReportSourceData {
  project: { id: string; name: string };
  tasks: ReportTaskInput[];
  milestones: ReportMilestoneInput[];
  risks: ReportRiskInput[];
  dependencies: ReportDependencyInput[];
}

export interface StatusReportItem {
  kind: StatusReportItemKind;
  id: string;
  title: string;
  status: string;
  date: string | null;
  detail: string | null;
  href: string;
}

export interface StatusReportCounts {
  tasks: number;
  openTasks: number;
  completedTasksInPeriod: number;
  milestones: number;
  openMilestones: number;
  completedMilestonesInPeriod: number;
  activeRisks: number;
  dependencyBlockers: number;
  blockers: number;
  overdue: number;
  upcoming: number;
}

export interface DeterministicStatusReport {
  version: 1;
  project: { id: string; name: string };
  observedAt: string;
  period: {
    start: string;
    end: string;
    upcomingStart: string;
    upcomingEnd: string;
  };
  health: ProjectHealth;
  counts: StatusReportCounts;
  sections: {
    completed: StatusReportItem[];
    blockers: StatusReportItem[];
    overdue: StatusReportItem[];
    upcoming: StatusReportItem[];
    risks: StatusReportItem[];
    dependencyBlockers: StatusReportItem[];
  };
}

export interface SavedStatusReport extends DeterministicStatusReport {
  narrative: string;
  confidence: "high" | "medium" | "low";
  citations: ProjectCitation[];
}

function addUtcDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * MS_PER_DAY);
}

function isoDay(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function taskItem(
  task: ReportTaskInput,
  projectId: string,
  date: Date | null = task.dueDate,
): StatusReportItem {
  const assignee = task.assignee?.name ?? task.assignee?.email ?? "unassigned";
  return {
    kind: "task",
    id: task.id,
    title: task.title,
    status: task.status.label,
    date: isoDay(date),
    detail: [
      `Priority: ${task.priority}`,
      `Assignee: ${assignee}`,
      task.milestone ? `Milestone: ${task.milestone.title}` : null,
      task.description,
    ]
      .filter(Boolean)
      .join(" · "),
    href: `/projects/${projectId}/tasks`,
  };
}

function milestoneItem(
  milestone: ReportMilestoneInput,
  projectId: string,
  date: Date | null = milestone.targetDate,
): StatusReportItem {
  return {
    kind: "milestone",
    id: milestone.id,
    title: milestone.title,
    status: milestone.status,
    date: isoDay(date),
    detail: milestone.description,
    href: `/projects/${projectId}/timeline`,
  };
}

function riskItem(
  risk: ReportRiskInput,
  projectId: string,
): StatusReportItem {
  return {
    kind: "risk",
    id: risk.id,
    title: risk.description,
    status: risk.status,
    date: null,
    detail: [
      `Impact: ${risk.impact}`,
      `Likelihood: ${risk.likelihood}`,
      risk.milestone ? `Milestone: ${risk.milestone.title}` : null,
      risk.mitigation ? `Mitigation: ${risk.mitigation}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    href: `/projects/${projectId}/risks`,
  };
}

function dependencyItem(
  dependency: ReportDependencyInput,
  projectId: string,
): StatusReportItem {
  return {
    kind: "dependency",
    id: dependency.id,
    title: `${dependency.task.title} depends on ${dependency.dependsOnTask.title}`,
    status: "blocked_by_prerequisite",
    date: null,
    detail: `Prerequisite status: ${dependency.dependsOnTask.status.label}`,
    href: `/projects/${projectId}/tasks`,
  };
}

function sortItems(items: StatusReportItem[]): StatusReportItem[] {
  return items.sort(
    (a, b) =>
      (a.date ?? "9999-12-31").localeCompare(b.date ?? "9999-12-31") ||
      a.title.localeCompare(b.title),
  );
}

export function hasReportableData(data: StatusReportSourceData): boolean {
  return (
    data.tasks.length > 0 ||
    data.milestones.length > 0 ||
    data.risks.length > 0 ||
    data.dependencies.length > 0
  );
}

/** Builds every factual report section without a model call. */
export function buildDeterministicStatusReport(
  data: StatusReportSourceData,
  now: Date = new Date(),
): DeterministicStatusReport {
  const today = startOfUtcDay(now);
  const tomorrow = addUtcDays(today, 1);
  const reportStart = addUtcDays(today, -6);
  const upcomingEndExclusive = addUtcDays(today, 8);
  const inCompletedWindow = (value: Date | null) =>
    value !== null && value >= reportStart && value < tomorrow;
  const inUpcomingWindow = (value: Date | null) =>
    value !== null && value >= tomorrow && value < upcomingEndExclusive;

  const completed = sortItems([
    ...data.tasks
      .filter(
        (task) =>
          task.status.category === DONE_TASK_CATEGORY &&
          inCompletedWindow(task.completedAt),
      )
      .map((task) => taskItem(task, data.project.id, task.completedAt)),
    ...data.milestones
      .filter(
        (milestone) =>
          milestone.status === "completed" &&
          inCompletedWindow(milestone.completedAt),
      )
      .map((milestone) =>
        milestoneItem(milestone, data.project.id, milestone.completedAt),
      ),
  ]);
  const blockers = sortItems([
    ...data.tasks
      .filter((task) => task.status.category === "blocked")
      .map((task) => taskItem(task, data.project.id)),
    ...data.milestones
      .filter((milestone) => milestone.status === "blocked")
      .map((milestone) => milestoneItem(milestone, data.project.id)),
  ]);
  const overdue = sortItems([
    ...data.tasks
      .filter((task) =>
        isOverdue(
          { date: task.dueDate, open: isTaskOpen(task.status.category) },
          today,
        ),
      )
      .map((task) => taskItem(task, data.project.id)),
    ...data.milestones
      .filter((milestone) =>
        isOverdue(
          {
            date: milestone.targetDate,
            open: isMilestoneOpen(milestone.status),
          },
          today,
        ),
      )
      .map((milestone) => milestoneItem(milestone, data.project.id)),
  ]);
  const upcoming = sortItems([
    ...data.tasks
      .filter(
        (task) => isTaskOpen(task.status.category) && inUpcomingWindow(task.dueDate),
      )
      .map((task) => taskItem(task, data.project.id)),
    ...data.milestones
      .filter(
        (milestone) =>
          isMilestoneOpen(milestone.status) &&
          inUpcomingWindow(milestone.targetDate),
      )
      .map((milestone) => milestoneItem(milestone, data.project.id)),
  ]);
  const activeRiskRows = data.risks.filter(
    (risk) => risk.status === "open" || risk.status === "monitoring",
  );
  const openRiskRows = data.risks.filter((risk) => risk.status === "open");
  const risks = activeRiskRows.map((risk) => riskItem(risk, data.project.id));
  const blockingDependencies = data.dependencies.filter(
    (dependency) =>
      dependency.task.status.category !== DONE_TASK_CATEGORY &&
      dependency.dependsOnTask.status.category !== DONE_TASK_CATEGORY,
  );
  const dependencyBlockers = blockingDependencies.map((dependency) =>
    dependencyItem(dependency, data.project.id),
  );

  const red =
    blockers.length > 0 ||
    overdue.length > 0 ||
    openRiskRows.some(
      (risk) => risk.impact === "high" && risk.likelihood === "high",
    );
  const dueSoon =
    data.tasks.some((task) =>
      isDueWithinDays(
        { date: task.dueDate, open: isTaskOpen(task.status.category) },
        today,
      ),
    ) ||
    data.milestones.some((milestone) =>
      isDueWithinDays(
        {
          date: milestone.targetDate,
          open: isMilestoneOpen(milestone.status),
        },
        today,
      ),
    );
  const amber =
    data.milestones.some((milestone) => milestone.status === "at_risk") ||
    dueSoon ||
    openRiskRows.some(
      (risk) => risk.impact === "high" || risk.likelihood === "high",
    );
  const health: ProjectHealth = red ? "red" : amber ? "amber" : "green";

  return {
    version: 1,
    project: data.project,
    observedAt: now.toISOString(),
    period: {
      start: reportStart.toISOString().slice(0, 10),
      end: today.toISOString().slice(0, 10),
      upcomingStart: tomorrow.toISOString().slice(0, 10),
      upcomingEnd: addUtcDays(today, 7).toISOString().slice(0, 10),
    },
    health,
    counts: {
      tasks: data.tasks.length,
      openTasks: data.tasks.filter((task) => isTaskOpen(task.status.category)).length,
      completedTasksInPeriod: completed.filter((item) => item.kind === "task").length,
      milestones: data.milestones.length,
      openMilestones: data.milestones.filter((milestone) =>
        isMilestoneOpen(milestone.status),
      ).length,
      completedMilestonesInPeriod: completed.filter(
        (item) => item.kind === "milestone",
      ).length,
      activeRisks: activeRiskRows.length,
      dependencyBlockers: dependencyBlockers.length,
      blockers: blockers.length,
      overdue: overdue.length,
      upcoming: upcoming.length,
    },
    sections: {
      completed,
      blockers,
      overdue,
      upcoming,
      risks,
      dependencyBlockers,
    },
  };
}

const REPORT_SOURCE_LIMIT = 60;

/** Creates opaque-ready model sources from the immutable deterministic report. */
export function buildReportGroundingSources(
  report: DeterministicStatusReport,
): ProjectGroundingSource[] {
  const allItems = [
    ...report.sections.blockers,
    ...report.sections.overdue,
    ...report.sections.completed,
    ...report.sections.upcoming,
    ...report.sections.risks,
    ...report.sections.dependencyBlockers,
  ];
  const seen = new Set<string>();
  const uniqueItems = allItems.filter((item) => {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const selected = uniqueItems.slice(0, REPORT_SOURCE_LIMIT);
  const partial = selected.length < uniqueItems.length;
  const snapshot: ProjectGroundingSource = {
    kind: "project_snapshot",
    id: report.project.id,
    title: `${report.project.name} weekly status snapshot`,
    href: `/projects/${report.project.id}/reports`,
    observedAt: report.observedAt,
    snapshot: {
      projectName: report.project.name,
      health: report.health,
      reportStart: report.period.start,
      reportEnd: report.period.end,
      ...report.counts,
      detailedRecordCount: selected.length,
      totalRelevantRecordCount: uniqueItems.length,
      partial,
    },
    content: [
      `Weekly project status snapshot: ${report.project.name}`,
      `Observation time: ${report.observedAt}`,
      `Report period: ${report.period.start} through ${report.period.end}`,
      `Derived health: ${report.health}`,
      `Exact counts: ${report.counts.completedTasksInPeriod} tasks and ${report.counts.completedMilestonesInPeriod} milestones completed; ${report.counts.blockers} blockers; ${report.counts.overdue} overdue items; ${report.counts.upcoming} upcoming items; ${report.counts.activeRisks} active risks; ${report.counts.dependencyBlockers} dependency blockers.`,
      partial
        ? `Detailed source list is partial: ${selected.length} of ${uniqueItems.length} report records are included.`
        : `Detailed source list is complete: ${selected.length} report records are included.`,
    ].join("\n"),
  };

  const detailed = selected.map<ProjectGroundingSource>((item) => ({
    kind: item.kind,
    id: item.id,
    title: item.title,
    href: item.href,
    observedAt: report.observedAt,
    snapshot: {
      title: item.title,
      status: item.status,
      date: item.date,
      detail: item.detail,
    },
    content: [
      `${item.kind}: ${item.title}`,
      `Status: ${item.status.replaceAll("_", " ")}`,
      item.date ? `Date: ${item.date}` : null,
      item.detail,
    ]
      .filter(Boolean)
      .join("\n"),
  }));

  return [snapshot, ...detailed];
}

export function statusReportToMarkdown(report: SavedStatusReport): string {
  const lines = [
    `# ${report.project.name} — Weekly Status Report`,
    "",
    `**Period:** ${report.period.start} to ${report.period.end}`,
    `**Health:** ${report.health.toUpperCase()}`,
    "",
    report.narrative,
  ];
  const sections: Array<[string, StatusReportItem[]]> = [
    ["Completed", report.sections.completed],
    ["Blockers", report.sections.blockers],
    ["Overdue", report.sections.overdue],
    ["Upcoming", report.sections.upcoming],
    ["Open and monitoring risks", report.sections.risks],
    ["Dependency blockers", report.sections.dependencyBlockers],
  ];
  for (const [title, items] of sections) {
    lines.push("", `## ${title}`, "");
    if (items.length === 0) lines.push("- None");
    else {
      for (const item of items) {
        lines.push(
          `- ${item.title} — ${item.status.replaceAll("_", " ")}${item.date ? ` (${item.date})` : ""}`,
        );
      }
    }
  }
  return lines.join("\n");
}
