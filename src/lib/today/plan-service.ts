import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { getUserPreferences, type WorkspaceAccess } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { extractJsonObject } from "@/lib/generation/prompt";
import { detectReplyLanguage, type ReplyLanguage } from "@/lib/language";
import { activityOf, getMyOpenTasks } from "@/lib/pm/my-work";
import { daysSinceActivity, isStale, officialRecordWhere } from "@/lib/pm/rules";
import { rankTasks } from "@/lib/pm/today";
import { getChatProvider, type ChatProvider } from "@/lib/providers";
import { DEFAULT_TIME_ZONE, localToday } from "@/lib/time";
import {
  buildDayPlanUserMessage,
  DAY_PLAN_PROMPT_VERSION,
  DAY_PLAN_SYSTEM_PROMPT,
  describeDue,
  MAX_PLAN_CANDIDATES,
  modelDayPlanSchema,
  planItemState,
  validateDayPlan,
  type PlanCandidate,
  type PlanItemState,
  type PlannedItem,
} from "@/lib/today/plan";

export class DayPlanError extends Error {
  constructor(
    message: string,
    readonly status: 422,
    /** "nothing_left": every open task is already in today's plan. */
    readonly code: "nothing_left" | null = null,
  ) {
    super(message);
    this.name = "DayPlanError";
  }
}

export interface DayPlanView {
  localDate: string;
  availableMinutes: number;
  summary: string;
  note: string | null;
  items: Array<
    PlannedItem & {
      title: string;
      projectId: string;
      projectName: string;
      batch: number;
      state: PlanItemState;
    }
  >;
  updatedAt: string;
}

function parsePlan(raw: string) {
  try {
    const parsed = modelDayPlanSchema.safeParse(JSON.parse(extractJsonObject(raw)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Suggests an order for today's work. One model call (plus one repair) over
 * the person's own open tasks, ranked deterministically so the same tasks give
 * the same candidates. Saved per person per local day; re-planning replaces it.
 * Tasks are never changed.
 *
 * `append` plans a next batch once the first is dealt with: the tasks already
 * in today's plan are left out, the new items are added after them, and the
 * hours add up — so a task is never planned twice in one day, and the earlier
 * batch stays on the card as what was done.
 */
export async function planMyDay(
  access: WorkspaceAccess,
  input: { availableHours: number; note?: string; append?: boolean },
  deps: { chat?: ChatProvider; now?: Date } = {},
): Promise<DayPlanView> {
  const now = deps.now ?? new Date();
  const preferences = await getUserPreferences(access.userId);
  const today = localToday(preferences?.timeZone ?? DEFAULT_TIME_ZONE, now);
  const fallback: ReplyLanguage = preferences?.locale === "en" ? "en" : "zh-Hant";
  const note = input.note?.trim() || null;
  const language = note ? detectReplyLanguage(note, fallback) : fallback;
  const availableMinutes = Math.round(input.availableHours * 60);

  const existing = input.append
    ? await prisma.dailyPlan.findFirst({
        where: { workspaceId: access.workspaceId, userId: access.userId, localDate: today },
      })
    : null;
  const previous = existing ? (existing.items as unknown as PlannedItem[]) : [];
  const alreadyPlanned = new Set(previous.map((item) => item.taskId));

  const tasks = await getMyOpenTasks(access.workspaceId, access.userId);
  const ranked = rankTasks(
    tasks
      .filter((task) => !alreadyPlanned.has(task.id))
      .map((task) => ({ ...task, stale: isStale(activityOf(task), today) })),
    today,
  ).slice(0, MAX_PLAN_CANDIDATES);
  if (ranked.length === 0) {
    throw existing
      ? new DayPlanError("Every open task is already in today's plan.", 422, "nothing_left")
      : new DayPlanError("You have no open tasks to plan.", 422);
  }

  const candidates = new Map<string, PlanCandidate>(
    ranked.map((task, index) => [
      `T${index + 1}`,
      {
        label: `T${index + 1}`,
        taskId: task.id,
        title: task.title,
        project: task.project.name,
        status: task.status.category,
        due: describeDue(task.dueDate, today, language),
        priority: task.priority,
        estimateMinutes: task.estimatedHours ? Math.round(task.estimatedHours * 60) : null,
        quietDays: daysSinceActivity(activityOf(task), today),
      },
    ]),
  );

  const chat = deps.chat ?? getChatProvider();
  const messages = [
    { role: "system" as const, content: DAY_PLAN_SYSTEM_PROMPT },
    {
      role: "user" as const,
      content: buildDayPlanUserMessage({
        today: today.toISOString().slice(0, 10),
        availableMinutes,
        note,
        candidates: [...candidates.values()],
        language,
      }),
    },
  ];
  const options = { jsonMode: true, temperature: 0, maxTokens: 3000, reasoning: false };

  let raw = await chat.complete(messages, options);
  let model = parsePlan(raw);
  if (!model) {
    raw = await chat.complete(
      [
        ...messages,
        { role: "assistant" as const, content: raw },
        {
          role: "user" as const,
          content: 'Reply with only one JSON object: {"summary":"...","items":[...]}.',
        },
      ],
      options,
    );
    model = parsePlan(raw);
  }
  if (!model) throw new DayPlanError("The model returned a malformed plan twice. Try again.", 422);

  const plan = validateDayPlan(model, candidates, availableMinutes, language);
  if (plan.items.length === 0) {
    throw new DayPlanError("The suggested plan named no tasks that fit. Try again with more time.", 422);
  }

  const batch = previous.reduce((highest, item) => Math.max(highest, item.batch ?? 1), 0) + 1;
  const planned = plan.items.map((item) => ({ ...item, batch, plannedAt: now.toISOString() }));
  const items = [...previous, ...planned] as unknown as Prisma.InputJsonValue;
  const totalMinutes = (existing?.availableMinutes ?? 0) + availableMinutes;
  const kept = note ?? existing?.note ?? null;

  await prisma.dailyPlan.upsert({
    where: {
      workspaceId_userId_localDate: {
        workspaceId: access.workspaceId,
        userId: access.userId,
        localDate: today,
      },
    },
    create: {
      workspaceId: access.workspaceId,
      userId: access.userId,
      localDate: today,
      availableMinutes: totalMinutes,
      items,
      summary: plan.summary,
      note: kept,
      modelName: chat.modelName,
      promptVersion: DAY_PLAN_PROMPT_VERSION,
    },
    update: {
      availableMinutes: totalMinutes,
      items,
      summary: plan.summary,
      note: kept,
      modelName: chat.modelName,
      promptVersion: DAY_PLAN_PROMPT_VERSION,
    },
  });

  const view = await getDayPlan(access, today);
  if (!view) throw new DayPlanError("The plan could not be read back. Try again.", 422);
  return view;
}

/**
 * Today's saved plan, joined with each task as it is now — a task finished
 * since planning shows as done, one touched since as updated
 * (`planItemState`); one deleted or no longer official drops out.
 */
export async function getDayPlan(
  access: WorkspaceAccess,
  today: Date,
): Promise<DayPlanView | null> {
  const plan = await prisma.dailyPlan.findFirst({
    where: { workspaceId: access.workspaceId, userId: access.userId, localDate: today },
  });
  if (!plan) return null;

  const items = plan.items as unknown as PlannedItem[];
  const tasks = await prisma.task.findMany({
    where: officialRecordWhere({
      id: { in: items.map((item) => item.taskId) },
      workspaceId: access.workspaceId,
    }),
    select: {
      id: true,
      title: true,
      projectId: true,
      project: { select: { name: true } },
      status: { select: { category: true } },
      updatedAt: true,
      comments: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });
  const byId = new Map(tasks.map((task) => [task.id, task]));

  return {
    localDate: today.toISOString().slice(0, 10),
    availableMinutes: plan.availableMinutes,
    summary: plan.summary,
    note: plan.note,
    items: items.flatMap((item) => {
      const task = byId.get(item.taskId);
      return task
        ? [
            {
              ...item,
              title: task.title,
              projectId: task.projectId,
              projectName: task.project.name,
              batch: item.batch ?? 1,
              state: planItemState(
                {
                  category: task.status.category,
                  updatedAt: task.updatedAt,
                  lastNoteAt: task.comments[0]?.createdAt ?? null,
                },
                // A plan from before items were stamped was made all at once.
                new Date(item.plannedAt ?? plan.updatedAt),
              ),
            },
          ]
        : [];
    }),
    updatedAt: plan.updatedAt.toISOString(),
  };
}
