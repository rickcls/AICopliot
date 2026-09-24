import "server-only";
import { prisma } from "@/lib/db";
import {
  activeProjectWhere,
  baselinedRequirementWhere,
  blockedTaskWhere,
  dueSoonTaskWhere,
  overdueTaskWhere,
  uncoveredRequirementWhere,
  unvalidatedRequirementWhere,
  upcomingMilestoneWhere,
  undecidedRequirementWhere,
  pendingPlanRunWhere,
  OPEN_REQUIREMENT_STATUSES,
  OPEN_TASK_CATEGORIES,
  DONE_TASK_CATEGORY,
  officialRecordWhere,
} from "./rules";

/**
 * Dashboard and project-overview counts.
 *
 * Every filter comes from ./rules.ts so the number on a card and the list under
 * it can never disagree, and so each query inherits the workspace constraint
 * rather than restating it.
 */

const LIST_LIMIT = 5;

export interface DashboardTaskRef {
  id: string;
  title: string;
  dueDate: Date | null;
  project: { id: string; name: string };
}

const dashboardTaskSelect = {
  id: true,
  title: true,
  dueDate: true,
  project: { select: { id: true, name: true } },
} as const;

export interface DashboardSummary {
  activeProjects: number;
  overdueTasks: number;
  blockedTasks: number;
  upcomingMilestones: number;
  overdueTaskList: DashboardTaskRef[];
  dueSoonTaskList: DashboardTaskRef[];
  blockedTaskList: DashboardTaskRef[];
  upcomingMilestoneList: Array<{
    id: string;
    title: string;
    targetDate: Date | null;
    project: { id: string; name: string };
  }>;
}

export async function getDashboardSummary(
  workspaceId: string,
  now: Date = new Date(),
): Promise<DashboardSummary> {
  const [
    activeProjects,
    overdueTasks,
    blockedTasks,
    upcomingMilestones,
    overdueTaskList,
    dueSoonTaskList,
    blockedTaskList,
    upcomingMilestoneList,
  ] = await Promise.all([
    prisma.project.count({ where: activeProjectWhere(workspaceId) }),
    prisma.task.count({ where: overdueTaskWhere(workspaceId, now) }),
    prisma.task.count({ where: blockedTaskWhere(workspaceId) }),
    prisma.milestone.count({ where: upcomingMilestoneWhere(workspaceId, now) }),
    prisma.task.findMany({
      where: overdueTaskWhere(workspaceId, now),
      orderBy: { dueDate: "asc" },
      take: LIST_LIMIT,
      select: dashboardTaskSelect,
    }),
    prisma.task.findMany({
      where: dueSoonTaskWhere(workspaceId, now),
      orderBy: { dueDate: "asc" },
      take: LIST_LIMIT,
      select: dashboardTaskSelect,
    }),
    prisma.task.findMany({
      where: blockedTaskWhere(workspaceId),
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      take: LIST_LIMIT,
      select: dashboardTaskSelect,
    }),
    prisma.milestone.findMany({
      where: upcomingMilestoneWhere(workspaceId, now),
      orderBy: { targetDate: "asc" },
      take: LIST_LIMIT,
      select: {
        id: true,
        title: true,
        targetDate: true,
        project: { select: { id: true, name: true } },
      },
    }),
  ]);

  return {
    activeProjects,
    overdueTasks,
    blockedTasks,
    upcomingMilestones,
    overdueTaskList,
    dueSoonTaskList,
    blockedTaskList,
    upcomingMilestoneList,
  };
}

export interface ProjectSummary {
  openTasks: number;
  doneTasks: number;
  overdueTasks: number;
  blockedTasks: number;
  dueSoonTasks: number;
  openRisks: number;
  openMilestones: number;
  readyDocuments: number;
  totalDocuments: number;
  totalRequirements: number;
  openRequirements: number;
  approvedRequirements: number;
  uncoveredRequirements: number;
  unvalidatedRequirements: number;
  undecidedRequirements: number;
  pendingPlanRuns: number;
}

export async function getProjectSummary(
  workspaceId: string,
  projectId: string,
  now: Date = new Date(),
): Promise<ProjectSummary> {
  const [
    openTasks,
    doneTasks,
    overdueTasks,
    blockedTasks,
    dueSoonTasks,
    openRisks,
    openMilestones,
    readyDocuments,
    totalDocuments,
    totalRequirements,
    openRequirements,
    approvedRequirements,
    uncoveredRequirements,
    unvalidatedRequirements,
    undecidedRequirements,
    pendingPlanRuns,
  ] = await Promise.all([
    prisma.task.count({
      where: officialRecordWhere({
        workspaceId,
        projectId,
        status: { category: { not: DONE_TASK_CATEGORY } },
      }),
    }),
    prisma.task.count({
      where: officialRecordWhere({
        workspaceId,
        projectId,
        status: { category: DONE_TASK_CATEGORY },
      }),
    }),
    prisma.task.count({ where: overdueTaskWhere(workspaceId, now, projectId) }),
    prisma.task.count({ where: blockedTaskWhere(workspaceId, projectId) }),
    prisma.task.count({
      where: dueSoonTaskWhere(workspaceId, now, projectId),
    }),
    prisma.projectRisk.count({
      where: officialRecordWhere({
        workspaceId,
        projectId,
        status: { in: ["open" as const, "monitoring" as const] },
      }),
    }),
    prisma.milestone.count({
      where: officialRecordWhere({
        workspaceId,
        projectId,
        status: { not: "completed" as const },
      }),
    }),
    prisma.document.count({ where: { workspaceId, projectId, status: "ready" } }),
    prisma.document.count({ where: { workspaceId, projectId } }),
    // The register deliberately counts drafts too: an unconfirmed requirement is
    // still something the team is carrying, unlike a draft task proposal.
    prisma.requirement.count({ where: { workspaceId, projectId } }),
    prisma.requirement.count({
      where: officialRecordWhere({
        workspaceId,
        projectId,
        status: { in: [...OPEN_REQUIREMENT_STATUSES] },
      }),
    }),
    prisma.requirement.count({
      where: baselinedRequirementWhere(workspaceId, projectId),
    }),
    prisma.requirement.count({
      where: uncoveredRequirementWhere(workspaceId, projectId),
    }),
    prisma.requirement.count({
      where: unvalidatedRequirementWhere(workspaceId, projectId),
    }),
    prisma.requirement.count({
      where: undecidedRequirementWhere(workspaceId, projectId),
    }),
    prisma.generationRun.count({
      where: pendingPlanRunWhere(workspaceId, projectId),
    }),
  ]);

  return {
    openTasks,
    doneTasks,
    overdueTasks,
    blockedTasks,
    dueSoonTasks,
    openRisks,
    openMilestones,
    readyDocuments,
    totalDocuments,
    totalRequirements,
    openRequirements,
    approvedRequirements,
    uncoveredRequirements,
    unvalidatedRequirements,
    undecidedRequirements,
    pendingPlanRuns,
  };
}

export interface ProjectHealthRow {
  id: string;
  name: string;
  openTasks: number;
  doneTasks: number;
  overdueTasks: number;
  blockedTasks: number;
  uncoveredRequirements: number;
  pendingPlanRuns: number;
}

/**
 * One row per project for the dashboard, built from grouped counts so the cost
 * is a fixed handful of queries however many projects there are. Each count
 * uses the same predicate as the project's own Overview, so the two pages
 * cannot disagree about a project.
 */
export async function getProjectHealthRows(
  workspaceId: string,
  now: Date = new Date(),
): Promise<ProjectHealthRow[]> {
  const [projects, open, done, overdue, blocked, uncovered, pending] =
    await Promise.all([
      prisma.project.findMany({
        where: { workspaceId },
        orderBy: { updatedAt: "desc" },
        select: { id: true, name: true },
      }),
      prisma.task.groupBy({
        by: ["projectId"],
        where: officialRecordWhere({
          workspaceId,
          status: { category: { in: [...OPEN_TASK_CATEGORIES] } },
        }),
        _count: { _all: true },
      }),
      prisma.task.groupBy({
        by: ["projectId"],
        where: officialRecordWhere({
          workspaceId,
          status: { category: DONE_TASK_CATEGORY },
        }),
        _count: { _all: true },
      }),
      prisma.task.groupBy({
        by: ["projectId"],
        where: overdueTaskWhere(workspaceId, now),
        _count: { _all: true },
      }),
      prisma.task.groupBy({
        by: ["projectId"],
        where: blockedTaskWhere(workspaceId),
        _count: { _all: true },
      }),
      prisma.requirement.groupBy({
        by: ["projectId"],
        where: uncoveredRequirementWhere(workspaceId),
        _count: { _all: true },
      }),
      prisma.generationRun.groupBy({
        by: ["projectId"],
        where: pendingPlanRunWhere(workspaceId),
        _count: { _all: true },
      }),
    ]);

  const byProject = (groups: Array<{ projectId: string; _count: { _all: number } }>) =>
    new Map(groups.map((group) => [group.projectId, group._count._all]));
  const counts = {
    open: byProject(open),
    done: byProject(done),
    overdue: byProject(overdue),
    blocked: byProject(blocked),
    uncovered: byProject(uncovered),
    pending: byProject(pending),
  };

  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    openTasks: counts.open.get(project.id) ?? 0,
    doneTasks: counts.done.get(project.id) ?? 0,
    overdueTasks: counts.overdue.get(project.id) ?? 0,
    blockedTasks: counts.blocked.get(project.id) ?? 0,
    uncoveredRequirements: counts.uncovered.get(project.id) ?? 0,
    pendingPlanRuns: counts.pending.get(project.id) ?? 0,
  }));
}
