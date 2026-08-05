import { notFound } from "next/navigation";
import {
  MilestonesPanel,
  type MilestoneRow,
} from "@/components/milestones-panel";
import { GanttChart } from "@/components/gantt-chart";
import { Badge, Card } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { buildGantt, type GanttInput } from "@/lib/pm/gantt";
import { getScopedProject } from "@/lib/pm/project";
import { milestoneSelect } from "@/lib/pm/select";
import {
  bucketTimeline,
  isMilestoneOpen,
  isOverdue,
  isTaskOpen,
  officialRecordWhere,
  DUE_SOON_DAYS,
  type TimelineItem,
} from "@/lib/pm/rules";
import { formatDay } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Read-only chronological view, so it stays a server component — there is no
 * interaction to hydrate apart from the milestone editor at the bottom.
 */

function Section({
  title,
  count,
  items,
  tone,
}: {
  title: string;
  count: number;
  items: TimelineItem[];
  tone?: "danger" | "warning";
}) {
  if (items.length === 0) return null;

  return (
    <div>
      <div className="flex items-baseline gap-2 px-1 pb-1.5">
        <h3
          className={
            tone === "danger"
              ? "text-xs font-semibold tracking-wide text-red-700 uppercase"
              : tone === "warning"
                ? "text-xs font-semibold tracking-wide text-amber-700 uppercase"
                : "text-xs font-semibold tracking-wide text-slate-500 uppercase"
          }
        >
          {title}
        </h3>
        <span className="text-xs text-slate-400 tabular-nums">{count}</span>
      </div>
      <Card className="divide-y divide-slate-100">
        {items.map((item) => (
          <div key={`${item.kind}-${item.id}`} className="px-4 py-2.5">
            {/* Title gets its own line: side-by-side with the badges it was
                being truncated to a couple of characters in a narrow column. */}
            <p className="text-sm text-pretty">{item.title}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <Badge tone={item.kind === "milestone" ? "info" : "neutral"}>
                {item.kind === "milestone" ? "Milestone" : "Task"}
              </Badge>
              <span className="text-xs text-slate-400">{item.status}</span>
              <span
                className={
                  tone === "danger"
                    ? "ml-auto text-xs font-medium text-red-700 tabular-nums"
                    : tone === "warning"
                      ? "ml-auto text-xs font-medium text-amber-700 tabular-nums"
                      : "ml-auto text-xs text-slate-500 tabular-nums"
                }
              >
                {item.date ? formatDay(item.date) : "No date"}
              </span>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

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

  const items: TimelineItem[] = [
    ...tasks.map((task) => ({
      id: task.id,
      kind: "task" as const,
      title: task.title,
      date: task.dueDate,
      open: isTaskOpen(task.status),
      status: task.status.replace("_", " "),
    })),
    ...milestones.map((milestone) => ({
      id: milestone.id,
      kind: "milestone" as const,
      title: milestone.title,
      date: milestone.targetDate,
      open: isMilestoneOpen(milestone.status),
      status: milestone.status.replace("_", " "),
    })),
  ];

  const buckets = bucketTimeline(items, now);

  const ganttInput: GanttInput[] = [
    ...tasks.map((task) => ({
      id: task.id,
      kind: "task" as const,
      title: task.title,
      start: task.startDate,
      end: task.dueDate,
      status: task.status,
      open: isTaskOpen(task.status),
      overdue: isOverdue(
        { date: task.dueDate, open: isTaskOpen(task.status) },
        now,
      ),
    })),
    ...milestones.map((milestone) => ({
      id: milestone.id,
      kind: "milestone" as const,
      title: milestone.title,
      start: null,
      end: milestone.targetDate,
      status: milestone.status,
      open: isMilestoneOpen(milestone.status),
      overdue: isOverdue(
        { date: milestone.targetDate, open: isMilestoneOpen(milestone.status) },
        now,
      ),
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

  const hasBuckets =
    buckets.overdue.length > 0 ||
    buckets.dueSoon.length > 0 ||
    buckets.upcoming.length > 0;

  return (
    <div className="space-y-6">
      <GanttChart model={buildGantt(ganttInput, now)} />

      {hasBuckets ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Section
            title="Overdue"
            count={buckets.overdue.length}
            items={buckets.overdue}
            tone="danger"
          />
          <Section
            title={`Next ${DUE_SOON_DAYS} days`}
            count={buckets.dueSoon.length}
            items={buckets.dueSoon}
            tone="warning"
          />
          <Section
            title="Later"
            count={buckets.upcoming.length}
            items={buckets.upcoming}
          />
        </div>
      ) : null}

      <MilestonesPanel
        projectId={project.id}
        initialMilestones={initialMilestones}
      />
    </div>
  );
}
