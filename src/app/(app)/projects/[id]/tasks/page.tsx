import { notFound } from "next/navigation";
import { TaskBoard } from "@/components/task-board";
import type { TaskRow, TaskStatusOption } from "@/components/task-types";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import {
  getAssignableMembers,
  getProjectMilestoneOptions,
  getScopedProject,
} from "@/lib/pm/project";
import { officialRecordWhere } from "@/lib/pm/rules";
import { taskSelect, taskStatusSelect } from "@/lib/pm/select";

export const dynamic = "force-dynamic";

export default async function ProjectTasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ task?: string | string[] }>;
}) {
  const { workspaceId, user } = await requireWorkspace();
  const { id } = await params;
  const { task: taskParam } = await searchParams;
  const requestedTaskId = Array.isArray(taskParam) ? taskParam[0] : taskParam;

  const project = await getScopedProject(workspaceId, id);
  if (!project) notFound();

  const [tasks, statuses, members, milestones] = await Promise.all([
    prisma.task.findMany({
      where: officialRecordWhere({ workspaceId, projectId: project.id }),
      orderBy: { createdAt: "asc" },
      select: taskSelect,
    }),
    prisma.projectTaskStatus.findMany({
      where: { workspaceId, projectId: project.id },
      orderBy: { position: "asc" },
      select: taskStatusSelect,
    }),
    getAssignableMembers(workspaceId),
    getProjectMilestoneOptions(workspaceId, project.id),
  ]);

  const initialTasks: TaskRow[] = tasks.map((task) => ({
    ...task,
    startDate: task.startDate ? task.startDate.toISOString() : null,
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    comments: task.comments.map((comment) => ({
      ...comment,
      createdAt: comment.createdAt.toISOString(),
    })),
  }));

  const initialStatuses: TaskStatusOption[] = statuses;

  return (
    <TaskBoard
      projectId={project.id}
      initialTasks={initialTasks}
      initialStatuses={initialStatuses}
      members={members}
      milestones={milestones}
      currentUserId={user.id}
      initialOpenTaskId={requestedTaskId ?? null}
    />
  );
}
