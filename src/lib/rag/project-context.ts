import "server-only";

import { prisma } from "@/lib/db";
import { readQuestionIntent } from "@/lib/rag/intent";
import {
  baselinedRequirementWhere,
  DONE_TASK_CATEGORY,
  formatRequirementCode,
  isMilestoneOpen,
  isOverdue,
  isTaskOpen,
  isDueWithinDays,
  officialRecordWhere,
} from "@/lib/pm/rules";

export type ProjectSourceKind =
  | "task"
  | "milestone"
  | "risk"
  | "dependency"
  | "requirement"
  | "note"
  | "project_snapshot";

export type ProjectSnapshotValue = string | number | boolean | null;

/**
 * A live project record frozen at answer time. The database ID is retained only
 * in the server-side map and persisted audit JSON; prompts receive an opaque
 * label plus `content`, never `id`.
 */
export interface ProjectGroundingSource {
  kind: ProjectSourceKind;
  id: string;
  title: string;
  content: string;
  href: string;
  observedAt: string;
  snapshot: Record<string, ProjectSnapshotValue>;
}

export interface ProjectGroundingContext {
  sources: ProjectGroundingSource[];
  observedAt: string;
  hasProjectData: boolean;
  totalDetailedRecords: number;
  selectedDetailedRecords: number;
  partial: boolean;
}

const MAX_DETAILED_SOURCES = 60;
/** A progress question reads the newest notes on the tasks it is about. */
const NOTES_PER_TASK = 3;
const NOTE_TASKS = 10;
/** A thread about one task reads more of that task's notes. */
const TASK_FOCUS_NOTES = 8;
const MAX_NOTE_CHARS = 600;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "our",
  "project",
  "the",
  "this",
  "to",
  "we",
  "what",
  "which",
  "who",
  "with",
]);

const HAN_RUN = /\p{Script=Han}+/gu;

/**
 * Words, plus Chinese character pairs. Written Chinese has no spaces, so
 * without the pairs a whole Chinese question was one token that matched no
 * record at all.
 */
function tokens(value: string): Set<string> {
  const lower = value.toLocaleLowerCase();
  const out = new Set(
    lower
      .replace(HAN_RUN, " ")
      .match(/[\p{L}\p{N}_-]+/gu)
      ?.filter((token) => token.length > 1 && !STOP_WORDS.has(token)) ?? [],
  );
  for (const run of lower.match(HAN_RUN) ?? []) {
    for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2));
  }
  return out;
}

function overlapScore(queryTokens: Set<string>, text: string): number {
  const sourceTokens = tokens(text);
  let score = 0;
  for (const token of queryTokens) {
    if (sourceTokens.has(token)) score += 3;
    else if ([...sourceTokens].some((candidate) => candidate.includes(token))) {
      score += 1;
    }
  }
  return score;
}

function includesAny(value: string, terms: readonly string[]): boolean {
  const normalized = value.toLocaleLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function isoDay(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function display(value: string): string {
  return value.replaceAll("_", " ");
}

type TaskRow = Awaited<ReturnType<typeof loadProjectRows>>["tasks"][number];
type MilestoneRow = Awaited<ReturnType<typeof loadProjectRows>>["milestones"][number];
type RiskRow = Awaited<ReturnType<typeof loadProjectRows>>["risks"][number];
type DependencyRow = Awaited<ReturnType<typeof loadProjectRows>>["dependencies"][number];
type RequirementRow = Awaited<ReturnType<typeof loadProjectRows>>["requirements"][number];

async function loadProjectRows(workspaceId: string, projectId: string) {
  const official = <T extends object>(where: T) => officialRecordWhere(where);

  const [project, tasks, milestones, risks, dependencies, requirements] =
    await Promise.all([
    prisma.project.findFirst({
      where: { id: projectId, workspaceId },
      select: { id: true, name: true },
    }),
    prisma.task.findMany({
      where: official({ workspaceId, projectId }),
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        title: true,
        description: true,
        status: { select: { key: true, label: true, category: true } },
        priority: true,
        startDate: true,
        dueDate: true,
        completedAt: true,
        assignee: { select: { name: true, email: true } },
        milestone: { select: { id: true, title: true } },
      },
    }),
    prisma.milestone.findMany({
      where: official({ workspaceId, projectId }),
      orderBy: [{ targetDate: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        targetDate: true,
        completedAt: true,
      },
    }),
    prisma.projectRisk.findMany({
      where: official({ workspaceId, projectId }),
      orderBy: [{ impact: "desc" }, { likelihood: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        description: true,
        impact: true,
        likelihood: true,
        mitigation: true,
        status: true,
        milestone: { select: { id: true, title: true } },
      },
    }),
    prisma.taskDependency.findMany({
      where: official({
        workspaceId,
        task: official({ workspaceId, projectId }),
        dependsOnTask: official({ workspaceId, projectId }),
      }),
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        task: {
          select: {
            id: true,
            title: true,
            status: { select: { key: true, label: true, category: true } },
            dueDate: true,
          },
        },
        dependsOnTask: {
          select: {
            id: true,
            title: true,
            status: { select: { key: true, label: true, category: true } },
            dueDate: true,
          },
        },
      },
    }),
    // Only baselined requirements: a draft is not agreed scope, so answering
    // "what did we agree?" from one would misrepresent the project.
    prisma.requirement.findMany({
      where: baselinedRequirementWhere(workspaceId, projectId),
      orderBy: { sequence: "asc" },
      select: {
        id: true,
        sequence: true,
        title: true,
        description: true,
        type: true,
        priority: true,
        acceptanceCriteria: true,
        assumptions: true,
        stakeholder: true,
        confidence: true,
        links: {
          where: { targetType: "task", task: officialRecordWhere({}) },
          select: {
            task: {
              select: {
                id: true,
                title: true,
                status: { select: { category: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  return { project, tasks, milestones, risks, dependencies, requirements };
}

function taskSource(
  task: TaskRow,
  projectId: string,
  observedAt: string,
): ProjectGroundingSource {
  const assignee = task.assignee?.name ?? task.assignee?.email ?? null;
  const snapshot = {
    title: task.title,
    description: task.description,
    status: task.status.category,
    statusLabel: task.status.label,
    priority: task.priority,
    assignee,
    startDate: isoDay(task.startDate),
    dueDate: isoDay(task.dueDate),
    completedAt: task.completedAt?.toISOString() ?? null,
    milestone: task.milestone?.title ?? null,
  };
  const content = [
    `Task: ${task.title}`,
    `Status: ${task.status.label}`,
    `Priority: ${task.priority}`,
    assignee ? `Assignee: ${assignee}` : "Assignee: unassigned",
    snapshot.startDate ? `Start date: ${snapshot.startDate}` : null,
    snapshot.dueDate ? `Due date: ${snapshot.dueDate}` : null,
    task.milestone ? `Milestone: ${task.milestone.title}` : null,
    task.description ? `Description: ${task.description}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    kind: "task",
    id: task.id,
    title: task.title,
    content,
    // Opens the task itself; TaskBoard reads `?task=` into its detail panel.
    href: `/projects/${projectId}/tasks?task=${task.id}`,
    observedAt,
    snapshot,
  };
}

function milestoneSource(
  milestone: MilestoneRow,
  projectId: string,
  observedAt: string,
): ProjectGroundingSource {
  const targetDate = isoDay(milestone.targetDate);
  const snapshot = {
    title: milestone.title,
    description: milestone.description,
    status: milestone.status,
    targetDate,
    completedAt: milestone.completedAt?.toISOString() ?? null,
  };
  const content = [
    `Milestone: ${milestone.title}`,
    `Status: ${display(milestone.status)}`,
    targetDate ? `Target date: ${targetDate}` : "Target date: none",
    milestone.description ? `Description: ${milestone.description}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    kind: "milestone",
    id: milestone.id,
    title: milestone.title,
    content,
    href: `/projects/${projectId}/timeline`,
    observedAt,
    snapshot,
  };
}

function riskSource(
  risk: RiskRow,
  projectId: string,
  observedAt: string,
): ProjectGroundingSource {
  const title = risk.description.slice(0, 120);
  const snapshot = {
    description: risk.description,
    impact: risk.impact,
    likelihood: risk.likelihood,
    mitigation: risk.mitigation,
    status: risk.status,
    milestone: risk.milestone?.title ?? null,
  };
  const content = [
    `Risk: ${risk.description}`,
    `Status: ${risk.status}`,
    `Impact: ${risk.impact}`,
    `Likelihood: ${risk.likelihood}`,
    risk.milestone ? `Milestone: ${risk.milestone.title}` : null,
    risk.mitigation ? `Mitigation: ${risk.mitigation}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    kind: "risk",
    id: risk.id,
    title,
    content,
    href: `/projects/${projectId}/risks`,
    observedAt,
    snapshot,
  };
}

function requirementSource(
  requirement: RequirementRow,
  projectId: string,
  observedAt: string,
): ProjectGroundingSource {
  const code = formatRequirementCode(requirement.sequence);
  const linkedTasks = requirement.links
    .map((link) => link.task?.title)
    .filter((title): title is string => Boolean(title));
  const snapshot = {
    code,
    title: requirement.title,
    description: requirement.description,
    type: requirement.type,
    priority: requirement.priority,
    status: "approved",
    acceptanceCriteria: requirement.acceptanceCriteria,
    assumptions: requirement.assumptions,
    stakeholder: requirement.stakeholder,
    confidence: requirement.confidence,
    linkedTaskCount: linkedTasks.length,
    covered: linkedTasks.length > 0,
  };
  const content = [
    `Requirement ${code}: ${requirement.title}`,
    `Type: ${display(requirement.type)}`,
    `Priority (MoSCoW): ${requirement.priority}`,
    "Status: approved",
    `Confidence: ${requirement.confidence}`,
    requirement.stakeholder ? `Stakeholder: ${requirement.stakeholder}` : null,
    requirement.description ? `Description: ${requirement.description}` : null,
    requirement.acceptanceCriteria
      ? `Acceptance criteria: ${requirement.acceptanceCriteria}`
      : "Acceptance criteria: none recorded",
    requirement.assumptions ? `Assumptions: ${requirement.assumptions}` : null,
    linkedTasks.length > 0
      ? `Delivery tasks (${linkedTasks.length}): ${linkedTasks.join("; ")}`
      : "Delivery tasks: none — this requirement is uncovered",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    kind: "requirement",
    id: requirement.id,
    title: `${code} ${requirement.title}`,
    content,
    href: `/projects/${projectId}/requirements`,
    observedAt,
    snapshot,
  };
}

type NoteRow = Awaited<ReturnType<typeof loadNotes>>[number];

/**
 * The newest notes on each task, newest first. Notes are what people write as
 * they work — a Today check-in, a progress note from a capture, a comment —
 * so they are where "how is it going?" is answered. Only official tasks reach
 * here, and the notes are read inside the same workspace.
 */
async function loadNotes(workspaceId: string, taskIds: string[], perTask: number) {
  if (taskIds.length === 0) return [];
  const rows = await prisma.taskComment.findMany({
    where: { workspaceId, taskId: { in: taskIds } },
    orderBy: { createdAt: "desc" },
    // Enough for every task to have its share even when one is chatty.
    take: taskIds.length * perTask * 3,
    select: {
      id: true,
      taskId: true,
      body: true,
      createdAt: true,
      author: { select: { name: true, email: true } },
    },
  });
  const kept = new Map<string, number>();
  return rows.filter((row) => {
    const count = kept.get(row.taskId) ?? 0;
    kept.set(row.taskId, count + 1);
    return count < perTask;
  });
}

/**
 * A person's note on a task, as evidence of its own kind. It says who wrote
 * what and when — a report of progress, never a document's requirement or a
 * field of the record — and the prompt asks for it to be attributed that way.
 */
function noteSource(
  note: NoteRow,
  task: { id: string; title: string },
  projectId: string,
  observedAt: string,
): ProjectGroundingSource {
  const author = note.author?.name ?? note.author?.email ?? "a former member";
  const writtenAt = note.createdAt.toISOString();
  return {
    kind: "note",
    id: note.id,
    title: task.title,
    content: [
      `Progress note on the task: ${task.title}`,
      `Written by: ${author}`,
      `Written at: ${writtenAt}`,
      `Note: ${note.body.slice(0, MAX_NOTE_CHARS)}`,
    ].join("\n"),
    href: `/projects/${projectId}/tasks?task=${task.id}`,
    observedAt,
    snapshot: { taskId: task.id, taskTitle: task.title, author, writtenAt },
  };
}

async function noteSourcesFor(
  workspaceId: string,
  projectId: string,
  tasks: { id: string; title: string }[],
  perTask: number,
  observedAt: string,
) {
  const titleById = new Map(tasks.map((task) => [task.id, task.title]));
  const notes = await loadNotes(workspaceId, [...titleById.keys()], perTask);
  return notes.map((note) =>
    noteSource(note, { id: note.taskId, title: titleById.get(note.taskId) ?? "" }, projectId, observedAt),
  );
}

/** Finished work: counted in the snapshot, left out of a list of what is still open. */
function isFinished(source: ProjectGroundingSource): boolean {
  const status = source.snapshot.status;
  return status === "done" || status === "completed" || status === "mitigated" || status === "accepted";
}

function dependencySource(
  dependency: DependencyRow,
  projectId: string,
  observedAt: string,
): ProjectGroundingSource {
  const title = `${dependency.task.title} depends on ${dependency.dependsOnTask.title}`;
  const snapshot = {
    task: dependency.task.title,
    taskStatus: dependency.task.status.category,
    taskDueDate: isoDay(dependency.task.dueDate),
    dependsOn: dependency.dependsOnTask.title,
    dependsOnStatus: dependency.dependsOnTask.status.category,
    dependsOnDueDate: isoDay(dependency.dependsOnTask.dueDate),
    blocking: dependency.dependsOnTask.status.category !== DONE_TASK_CATEGORY,
  };
  const content = [
    `Dependency: ${title}`,
    `Dependent task status: ${dependency.task.status.label}`,
    `Prerequisite status: ${dependency.dependsOnTask.status.label}`,
    snapshot.taskDueDate ? `Dependent due date: ${snapshot.taskDueDate}` : null,
    snapshot.dependsOnDueDate
      ? `Prerequisite due date: ${snapshot.dependsOnDueDate}`
      : null,
    `Currently blocking: ${snapshot.blocking ? "yes" : "no"}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    kind: "dependency",
    id: dependency.id,
    title,
    content,
    href: `/projects/${projectId}/tasks`,
    observedAt,
    snapshot,
  };
}

function sourceScore(
  source: ProjectGroundingSource,
  question: string,
  queryTokens: Set<string>,
  now: Date,
): number {
  let score = overlapScore(queryTokens, `${source.title}\n${source.content}`);

  if (
    source.kind === "task" &&
    includesAny(question, ["task", "work", "action", "assignee", "owner", "who", "工作", "任務", "待辦", "負責", "邊個", "誰"])
  ) {
    score += 2;
  }
  if (
    source.kind === "milestone" &&
    includesAny(question, ["milestone", "target", "delivery", "phase", "里程碑", "交付", "階段"])
  ) {
    score += 2;
  }
  if (
    source.kind === "risk" &&
    includesAny(question, ["risk", "mitigation", "impact", "likelihood", "風險", "緩解", "影響"])
  ) {
    score += 3;
  }
  if (
    source.kind === "dependency" &&
    includesAny(question, ["block", "depend", "prerequisite", "before", "uat", "受阻", "卡住", "依賴", "前置"])
  ) {
    score += 4;
  }
  if (
    source.kind === "requirement" &&
    includesAny(question, [
      "requirement",
      "scope",
      "acceptance",
      "must",
      "should",
      "agreed",
      "stakeholder",
      "criteria",
      "需求",
      "範圍",
      "驗收",
      "必須",
      "議定",
    ])
  ) {
    score += 4;
  }
  // "Which requirements have no task?" must reach the uncovered ones, and a
  // coverage question names neither their title nor their text.
  if (
    source.kind === "requirement" &&
    source.snapshot.covered === false &&
    includesAny(question, ["uncovered", "no task", "not covered", "coverage", "gap", "未覆蓋", "覆蓋", "缺口", "沒有工作", "未有工作"])
  ) {
    score += 6;
  }

  const status = String(source.snapshot.status ?? "");
  if (includesAny(question, ["block", "stuck", "受阻", "卡住"]) && status === "blocked") score += 6;
  if (includesAny(question, ["complete", "done", "finished", "完成", "做完", "搞掂"])) {
    if (status === "done" || status === "completed") score += 4;
  }
  if (includesAny(question, ["open", "active", "current", "status", "progress", "進度", "狀態", "目前"])) {
    score += 1;
  }

  const dateValue =
    typeof source.snapshot.dueDate === "string"
      ? source.snapshot.dueDate
      : typeof source.snapshot.targetDate === "string"
        ? source.snapshot.targetDate
        : null;
  const open =
    source.kind === "task"
      ? status !== "done"
      : source.kind === "milestone"
        ? status !== "completed"
        : false;
  if (dateValue) {
    const dated = { date: new Date(`${dateValue}T00:00:00.000Z`), open };
    if (includesAny(question, ["overdue", "late", "past due", "逾期", "過期", "遲咗"]) && isOverdue(dated, now)) {
      score += 6;
    }
    if (includesAny(question, ["week", "upcoming", "due", "next", "星期", "到期", "下週", "快到"]) && isDueWithinDays(dated, now)) {
      score += 4;
    }
  }

  return score;
}

function buildSnapshotSource(
  project: { id: string; name: string },
  tasks: TaskRow[],
  milestones: MilestoneRow[],
  risks: RiskRow[],
  dependencies: DependencyRow[],
  requirements: RequirementRow[],
  observedAt: string,
  now: Date,
  selectedCount: number,
  relevantCount: number,
): ProjectGroundingSource {
  const openTasks = tasks.filter((task) => isTaskOpen(task.status.category));
  const openMilestones = milestones.filter((milestone) =>
    isMilestoneOpen(milestone.status),
  );
  const activeRisks = risks.filter((risk) =>
    risk.status === "open" || risk.status === "monitoring",
  );
  const openRisks = risks.filter((risk) => risk.status === "open");
  const overdueTasks = openTasks.filter((task) =>
    isOverdue({ date: task.dueDate, open: true }, now),
  );
  const dueSoonTasks = openTasks.filter((task) =>
    isDueWithinDays({ date: task.dueDate, open: true }, now),
  );
  const overdueMilestones = openMilestones.filter((milestone) =>
    isOverdue({ date: milestone.targetDate, open: true }, now),
  );
  const dueSoonMilestones = openMilestones.filter((milestone) =>
    isDueWithinDays({ date: milestone.targetDate, open: true }, now),
  );
  const dependencyBlockers = dependencies.filter(
    (dependency) =>
      dependency.task.status.category !== DONE_TASK_CATEGORY &&
      dependency.dependsOnTask.status.category !== DONE_TASK_CATEGORY,
  );
  const uncoveredRequirements = requirements.filter(
    (requirement) => requirement.links.length === 0,
  );
  const mustRequirements = requirements.filter(
    (requirement) => requirement.priority === "must",
  );
  const uncoveredMustRequirements = mustRequirements.filter(
    (requirement) => requirement.links.length === 0,
  );
  const unvalidatedRequirements = requirements.filter(
    (requirement) => !requirement.acceptanceCriteria,
  );
  const partial = selectedCount < relevantCount;
  const red =
    tasks.some((task) => task.status.category === "blocked") ||
    milestones.some((milestone) => milestone.status === "blocked") ||
    overdueTasks.length > 0 ||
    overdueMilestones.length > 0 ||
    openRisks.some(
      (risk) => risk.impact === "high" && risk.likelihood === "high",
    );
  const amber =
    milestones.some((milestone) => milestone.status === "at_risk") ||
    dueSoonTasks.length > 0 ||
    dueSoonMilestones.length > 0 ||
    openRisks.some(
      (risk) => risk.impact === "high" || risk.likelihood === "high",
    );
  const health = red ? "red" : amber ? "amber" : "green";

  const snapshot = {
    projectName: project.name,
    health,
    taskCount: tasks.length,
    openTaskCount: openTasks.length,
    doneTaskCount: tasks.length - openTasks.length,
    blockedTaskCount: tasks.filter((task) => task.status.category === "blocked")
      .length,
    overdueTaskCount: overdueTasks.length,
    dueSoonTaskCount: dueSoonTasks.length,
    milestoneCount: milestones.length,
    openMilestoneCount: openMilestones.length,
    completedMilestoneCount: milestones.length - openMilestones.length,
    blockedMilestoneCount: milestones.filter(
      (milestone) => milestone.status === "blocked",
    ).length,
    atRiskMilestoneCount: milestones.filter(
      (milestone) => milestone.status === "at_risk",
    ).length,
    overdueMilestoneCount: overdueMilestones.length,
    dueSoonMilestoneCount: dueSoonMilestones.length,
    riskCount: risks.length,
    activeRiskCount: activeRisks.length,
    dependencyCount: dependencies.length,
    dependencyBlockerCount: dependencyBlockers.length,
    approvedRequirementCount: requirements.length,
    mustRequirementCount: mustRequirements.length,
    uncoveredRequirementCount: uncoveredRequirements.length,
    uncoveredMustRequirementCount: uncoveredMustRequirements.length,
    unvalidatedRequirementCount: unvalidatedRequirements.length,
    detailedRecordCount: selectedCount,
    relevantRecordCount: relevantCount,
    partial,
  };

  const content = [
    `Project snapshot: ${project.name}`,
    `Observed at: ${observedAt}`,
    `Derived project health: ${health}.`,
    `Exact task counts: ${tasks.length} total; ${openTasks.length} open; ${tasks.length - openTasks.length} done; ${snapshot.blockedTaskCount} blocked; ${overdueTasks.length} overdue; ${dueSoonTasks.length} due within 7 days.`,
    `Exact milestone counts: ${milestones.length} total; ${openMilestones.length} open; ${snapshot.completedMilestoneCount} completed; ${snapshot.blockedMilestoneCount} blocked; ${snapshot.atRiskMilestoneCount} at risk; ${overdueMilestones.length} overdue; ${dueSoonMilestones.length} due within 7 days.`,
    `Exact risk counts: ${risks.length} total; ${activeRisks.length} open or monitoring.`,
    `Exact dependency counts: ${dependencies.length} total; ${dependencyBlockers.length} currently blocked by an unfinished prerequisite.`,
    `Exact approved-requirement counts: ${requirements.length} approved; ${mustRequirements.length} priority must; ${uncoveredRequirements.length} with no delivery task, of which ${uncoveredMustRequirements.length} are priority must; ${unvalidatedRequirements.length} with no acceptance criteria. Draft and unapproved requirements are excluded from every count above.`,
    partial
      ? `Detailed source list is partial: ${selectedCount} of ${relevantCount} relevant records are included.`
      : `Detailed source list is complete: ${selectedCount} relevant records are included.`,
  ].join("\n");

  return {
    kind: "project_snapshot",
    id: project.id,
    title: `${project.name} snapshot`,
    content,
    href: `/projects/${project.id}`,
    observedAt,
    snapshot,
  };
}

/**
 * Selects current, official project data with deterministic lexical and intent
 * matching. Aggregate counts are exact even when detailed records hit the cap.
 */
export async function getProjectGroundingContext(
  workspaceId: string,
  projectId: string,
  question: string,
  now: Date = new Date(),
): Promise<ProjectGroundingContext> {
  const rows = await loadProjectRows(workspaceId, projectId);
  const observedAt = now.toISOString();
  const hasProjectData =
    rows.tasks.length > 0 ||
    rows.milestones.length > 0 ||
    rows.risks.length > 0 ||
    rows.dependencies.length > 0 ||
    rows.requirements.length > 0;

  if (!rows.project || !hasProjectData) {
    return {
      sources: [],
      observedAt,
      hasProjectData: false,
      totalDetailedRecords: 0,
      selectedDetailedRecords: 0,
      partial: false,
    };
  }

  const detailed = [
    ...rows.requirements.map((requirement) =>
      requirementSource(requirement, projectId, observedAt),
    ),
    ...rows.tasks.map((task) => taskSource(task, projectId, observedAt)),
    ...rows.milestones.map((milestone) =>
      milestoneSource(milestone, projectId, observedAt),
    ),
    ...rows.risks.map((risk) => riskSource(risk, projectId, observedAt)),
    ...rows.dependencies.map((dependency) =>
      dependencySource(dependency, projectId, observedAt),
    ),
  ];
  const intent = readQuestionIntent(question);
  const queryTokens = tokens(question);
  const scored = detailed
    .map((source, index) => ({
      source,
      index,
      score: sourceScore(source, question, queryTokens, now),
    }))
    // "What is still pending?" was answered with finished tasks, because the
    // word "task" alone selected every task. Finished work stays in the
    // snapshot's exact counts; only the open work is listed.
    .filter((candidate) => candidate.score > 0 && !(intent.openWork && isFinished(candidate.source)))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = scored
    .slice(0, MAX_DETAILED_SOURCES)
    .map((candidate) => candidate.source);
  const notes = intent.progress
    ? await noteSourcesFor(
        workspaceId,
        projectId,
        selected.filter((source) => source.kind === "task").slice(0, NOTE_TASKS),
        NOTES_PER_TASK,
        observedAt,
      )
    : [];
  const snapshot = buildSnapshotSource(
    rows.project,
    rows.tasks,
    rows.milestones,
    rows.risks,
    rows.dependencies,
    rows.requirements,
    observedAt,
    now,
    selected.length,
    scored.length,
  );

  return {
    sources: [snapshot, ...selected, ...notes],
    observedAt,
    hasProjectData: true,
    totalDetailedRecords: scored.length,
    selectedDetailedRecords: selected.length,
    partial: selected.length < scored.length,
  };
}

export interface TaskGroundingContext {
  task: { id: string; projectId: string; title: string } | null;
  sources: ProjectGroundingSource[];
  observedAt: string;
}

/**
 * The live records a task-focused thread answers from: the task itself —
 * always first, whatever the question — then its dependencies either way, its
 * milestone, and the *approved* requirements it delivers.
 *
 * Built from the same rows and the same source builders as the project
 * context, so a task reads identically in both and a citation's snapshot has
 * one shape. Official records only, like every operational read: a draft task
 * cannot be the focus of a thread. Comments are deliberately absent — they
 * are discussion, not evidence.
 */
export async function getTaskGroundingContext(
  workspaceId: string,
  projectId: string,
  taskId: string,
  now: Date = new Date(),
): Promise<TaskGroundingContext> {
  const observedAt = now.toISOString();
  const rows = await loadProjectRows(workspaceId, projectId);
  const task = rows.tasks.find((row) => row.id === taskId);
  if (!rows.project || !task) return { task: null, sources: [], observedAt };

  const milestone = task.milestone
    ? rows.milestones.find((row) => row.id === task.milestone?.id)
    : undefined;
  const dependencies = rows.dependencies.filter(
    (row) => row.task.id === taskId || row.dependsOnTask.id === taskId,
  );
  const requirements = rows.requirements.filter((requirement) =>
    requirement.links.some((link) => link.task?.id === taskId),
  );
  // A thread about one task is usually a question about its progress, so its
  // notes always come along.
  const notes = await noteSourcesFor(workspaceId, projectId, [task], TASK_FOCUS_NOTES, observedAt);

  return {
    task: { id: task.id, projectId, title: task.title },
    sources: [
      taskSource(task, projectId, observedAt),
      ...dependencies.map((row) => dependencySource(row, projectId, observedAt)),
      ...(milestone ? [milestoneSource(milestone, projectId, observedAt)] : []),
      ...requirements.map((row) => requirementSource(row, projectId, observedAt)),
      ...notes,
    ],
    observedAt,
  };
}
