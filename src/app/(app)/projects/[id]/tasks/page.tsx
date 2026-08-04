import { notFound } from "next/navigation";
import { TaskBoard } from "@/components/task-board";
import type { TaskRow } from "@/components/task-types";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { getAssignableMembers, getScopedProject } from "@/lib/pm/project";
import { taskSelect } from "@/lib/pm/select";

export const dynamic = "force-dynamic";

export default async function ProjectTasksPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { workspaceId } = await requireWorkspace();
  const { id } = await params;

  const project = await getScopedProject(workspaceId, id);
  if (!project) notFound();

  const [tasks, members] = await Promise.all([
    prisma.task.findMany({
      where: { workspaceId, projectId: project.id },
      orderBy: { createdAt: "asc" },
      select: taskSelect,
    }),
    getAssignableMembers(workspaceId),
  ]);

  // Dates are serialised here rather than in the client component, which cannot
  // receive Date instances across the server/client boundary.
  const initialTasks: TaskRow[] = tasks.map((task) => ({
    ...task,
    startDate: task.startDate ? task.startDate.toISOString() : null,
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
  }));

  return (
    <TaskBoard
      projectId={project.id}
      initialTasks={initialTasks}
      members={members}
    />
  );
}
