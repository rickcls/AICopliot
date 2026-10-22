import "server-only";
import { prisma } from "@/lib/db";
import { rankTaskCandidates } from "@/lib/capture/candidates";
import type { PromptProject, PromptTask } from "@/lib/capture/prompt";
import type { CandidateRef } from "@/lib/capture/validate";
import { getMyOpenTasks } from "@/lib/pm/my-work";
import { visibleProjectWhere } from "@/lib/pm/visibility";

/** Enough projects to file under; a workspace with more names them in the line. */
const MAX_PROJECT_LABELS = 60;
const MAX_TASK_CANDIDATES = 40;

/**
 * What the model is shown besides the note: the person's open tasks as T
 * labels and the projects they can see as P labels. Labels are assigned here
 * and resolved back through the returned maps; no id reaches the prompt.
 */
export async function loadCaptureContext(
  access: { workspaceId: string; userId: string },
  body: string,
  today: Date,
) {
  const [tasks, projects] = await Promise.all([
    getMyOpenTasks(access.workspaceId, access.userId),
    prisma.project.findMany({
      where: visibleProjectWhere(access.workspaceId, access.userId),
      orderBy: { updatedAt: "desc" },
      take: MAX_PROJECT_LABELS,
      select: { id: true, name: true, personalOwnerId: true },
    }),
  ]);

  const projectLabelById = new Map(projects.map((project, index) => [project.id, `P${index + 1}`]));
  const projectLabels = new Map(projects.map((project, index) => [`P${index + 1}`, project.id]));
  const promptProjects: PromptProject[] = projects.map((project, index) => ({
    label: `P${index + 1}`,
    name: project.name,
    personal: project.personalOwnerId === access.userId,
  }));

  const ranked = rankTaskCandidates(tasks, body, today, MAX_TASK_CANDIDATES);
  const taskLabels = new Map<string, CandidateRef>();
  const promptTasks: PromptTask[] = ranked.map((task, index) => {
    const label = `T${index + 1}`;
    const dueDate = task.dueDate ? task.dueDate.toISOString().slice(0, 10) : null;
    taskLabels.set(label, {
      id: task.id,
      title: task.title,
      category: task.status.category,
      dueDate,
      priority: task.priority,
      statusKey: task.status.key,
    });
    return {
      label,
      title: task.title,
      projectLabel: projectLabelById.get(task.project.id) ?? null,
      category: task.status.category,
      statusKey: task.status.key,
      dueDate,
      priority: task.priority,
    };
  });

  return { promptTasks, promptProjects, projectLabels, taskLabels };
}
