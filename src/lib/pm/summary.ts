import "server-only";
import { prisma } from "@/lib/db";
import {
  activeProjectWhere,
  baselinedRequirementWhere,
  blockedTaskWhere,
  overdueTaskWhere,
  uncoveredRequirementWhere,
  unvalidatedRequirementWhere,
  upcomingMilestoneWhere,
  startOfUtcDay,
  DUE_SOON_DAYS,
  OPEN_REQUIREMENT_STATUSES,
  OPEN_TASK_STATUSES,
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

export interface DashboardSummary {
  activeProjects: number;
  overdueTasks: number;
  blockedTasks: number;
  upcomingMilestones: number;
  overdueTaskList: Array<{
    id: string;
    title: string;
    dueDate: Date | null;
    project: { id: string; name: string };
  }>;
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
      select: {
        id: true,
        title: true,
        dueDate: true,
        project: { select: { id: true, name: true } },
      },
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
}

export async function getProjectSummary(
  workspaceId: string,
  projectId: string,
  now: Date = new Date(),
): Promise<ProjectSummary> {
  const dueSoonCutoff = new Date(now);
  dueSoonCutoff.setUTCDate(dueSoonCutoff.getUTCDate() + DUE_SOON_DAYS);

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
  ] = await Promise.all([
    prisma.task.count({
      where: officialRecordWhere({
        workspaceId,
        projectId,
        status: { not: "done" as const },
      }),
    }),
    prisma.task.count({
      where: officialRecordWhere({
        workspaceId,
        projectId,
        status: "done" as const,
      }),
    }),
    prisma.task.count({ where: overdueTaskWhere(workspaceId, now, projectId) }),
    prisma.task.count({ where: blockedTaskWhere(workspaceId, projectId) }),
    prisma.task.count({
      where: officialRecordWhere({
        workspaceId,
        projectId,
        status: { in: [...OPEN_TASK_STATUSES] },
        dueDate: { gte: startOfUtcDay(now), lte: dueSoonCutoff },
      }),
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
  };
}
