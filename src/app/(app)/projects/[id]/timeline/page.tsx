import { notFound } from "next/navigation";
import {
  MilestonesPanel,
  type MilestoneRow,
} from "@/components/milestones-panel";
import {
  ProjectTimeline,
  type TimelineRow,
} from "@/components/project-timeline";
import { TimelineProgress } from "@/components/timeline-progress";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { getScopedProject } from "@/lib/pm/project";
import { countProgress } from "@/lib/pm/progress";
import { milestoneSelect } from "@/lib/pm/select";
import {
  isMilestoneOpen,
  isTaskOpen,
  officialRecordWhere,
} from "@/lib/pm/rules";

export const dynamic = "force-dynamic";

/**
 * Schedule and progress for one project.
 *
 * The rollup is counted here and rendered by a server component; the chart shell
 * is a client component because its view toggle and month cursor are state. Both
 * receive the same `now`, so the server render and the hydrated one cannot
 * disagree about what is overdue.
 */
export default async function ProjectTimelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { workspaceId } = await requireWorkspace();
  const { id } = await params;

  const project = await getScopedProject(workspaceId, id);
  if (!project) notFound();

  const [tasks, milestones] = await Promise.all([
    prisma.task.findMany({
      where: officialRecordWhere({ workspaceId, projectId: project.id }),
      orderBy: [{ startDate: "asc" }, { dueDate: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        title: true,
        startDate: true,
        dueDate: true,
        status: true,
      },
    }),
    prisma.milestone.findMany({
      where: officialRecordWhere({ workspaceId, projectId: project.id }),
      orderBy: [{ targetDate: "asc" }, { createdAt: "asc" }],
      select: milestoneSelect,
    }),
  ]);

  const now = new Date();

  const taskProgress = countProgress(
    tasks.map((task) => ({
      status: task.status,
      open: isTaskOpen(task.status),
      date: task.dueDate,
    })),
    now,
  );
  const milestoneProgress = countProgress(
    milestones.map((milestone) => ({
      status: milestone.status,
      open: isMilestoneOpen(milestone.status),
      date: milestone.targetDate,
    })),
    now,
  );

  const rows: TimelineRow[] = [
    ...tasks.map((task) => ({
      id: task.id,
      kind: "task" as const,
      title: task.title,
      start: task.startDate ? task.startDate.toISOString() : null,
      end: task.dueDate ? task.dueDate.toISOString() : null,
      status: task.status,
      open: isTaskOpen(task.status),
    })),
    ...milestones.map((milestone) => ({
      id: milestone.id,
      kind: "milestone" as const,
      title: milestone.title,
      start: null,
      end: milestone.targetDate ? milestone.targetDate.toISOString() : null,
      status: milestone.status,
      open: isMilestoneOpen(milestone.status),
    })),
  ];

  const initialMilestones: MilestoneRow[] = milestones.map((milestone) => ({
    ...milestone,
    targetDate: milestone.targetDate
      ? milestone.targetDate.toISOString()
      : null,
    completedAt: milestone.completedAt
      ? milestone.completedAt.toISOString()
      : null,
  }));

  return (
    <div className="space-y-6">
      <TimelineProgress tasks={taskProgress} milestones={milestoneProgress} />

      <ProjectTimeline rows={rows} nowIso={now.toISOString()} />

      <MilestonesPanel
        projectId={project.id}
        initialMilestones={initialMilestones}
      />
    </div>
  );
}
