import { CaptureWorkspace } from "@/components/capture/capture-workspace";
import { DayPlanCard } from "@/components/today/day-plan-card";
import { TodayTaskRow, type TodayRowTask } from "@/components/today/today-task-row";
import { Card, EmptyState, LinkButton, SectionHeader } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth-guard";
import { getCaptureProjectOptions, listCaptures } from "@/lib/capture/service";
import { toCaptureView } from "@/lib/capture/view";
import { intlLocale } from "@/lib/i18n/locales";
import { getLocale, getT } from "@/lib/i18n/server";
import { displayStatusLabel } from "@/lib/i18n/status-labels";
import type { MessageKey, Translate } from "@/lib/i18n/translate";
import {
  activityOf,
  getMyOpenTasks,
  isSoloWorkspace,
  type MyOpenTask,
} from "@/lib/pm/my-work";
import { daysSinceActivity, isStale } from "@/lib/pm/rules";
import { bucketMyTasks } from "@/lib/pm/today";
import { getDayPlan } from "@/lib/today/plan-service";
import { formatDay } from "@/lib/utils";
import { getViewerToday } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/**
 * Home. Answers one question — what needs me now — across every project,
 * using the viewer's own calendar day so a task due today in Hong Kong is due
 * today here, not tomorrow until 08:00.
 *
 * Top to bottom: tell the assistant something (capture), the day's suggested
 * order (plan), then the work itself in buckets. Only buckets with something
 * in them are drawn. Work gone quiet is badged where it already appears, and
 * listed under "Needs an update" only when no other bucket shows it, so no
 * task is listed twice.
 */
export default async function TodayPage() {
  const access = await requireWorkspace();
  const { workspaceId, userId } = access;
  const today = await getViewerToday();
  const [t, locale, solo, tasks, waiting, captureOptions, plan] = await Promise.all([
    getT(),
    getLocale(),
    isSoloWorkspace(workspaceId),
    getMyOpenTasks(workspaceId, userId),
    listCaptures(access, { pendingOnly: true, limit: 3 }),
    getCaptureProjectOptions(access),
    getDayPlan(access, today),
  ]);

  const dateLocale = intlLocale(locale);
  // `today` is UTC midnight of the viewer's date, so formatting it in UTC
  // prints that date whatever zone the server runs in.
  const heading = new Intl.DateTimeFormat(dateLocale, {
    dateStyle: "full",
    timeZone: "UTC",
  }).format(today);

  const buckets = bucketMyTasks(tasks, today);
  const toRow = (task: MyOpenTask, overdue: boolean) =>
    rowFor(task, { t, dateLocale, today, overdue });

  const allSections: { key: string; title: MessageKey; rows: TodayRowTask[] }[] = [
    { key: "overdue", title: "today.overdue", rows: buckets.overdue.map((task) => toRow(task, true)) },
    { key: "dueToday", title: "today.dueToday", rows: buckets.dueToday.map((task) => toRow(task, false)) },
    { key: "blocked", title: "today.blocked", rows: buckets.blocked.map((task) => toRow(task, false)) },
    { key: "dueSoon", title: "today.dueSoon", rows: buckets.dueSoon.map((task) => toRow(task, false)) },
  ];
  const sections = allSections.filter((section) => section.rows.length > 0);
  const quietLater = buckets.later
    .map((task) => toRow(task, false))
    .filter((row) => row.staleDays !== null);
  const laterCount = buckets.later.length - quietLater.length;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("today.title")}</h1>
        <p className="mt-1 text-sm text-slate-600">
          <span className="font-medium text-slate-900">{heading}</span>
          <span className="mx-1.5 text-slate-300">·</span>
          {solo ? t("today.soloLead") : t("today.lead")}
        </p>
      </div>

      <div className="mb-8">
        <CaptureWorkspace
          compact
          initialCaptures={waiting.map(toCaptureView)}
          projects={captureOptions.projects}
          colleagues={captureOptions.colleagues}
          personalProjectId={captureOptions.personalProjectId}
        />
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          title={t("today.noTasksTitle")}
          description={t("today.noTasksBody")}
          action={<LinkButton href="/projects">{t("today.openProjects")}</LinkButton>}
        />
      ) : (
        <div className="space-y-6">
          <DayPlanCard initialPlan={plan} />

          {sections.length === 0 && quietLater.length === 0 ? (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-slate-900">
                {t("today.allClearTitle")}
              </h2>
              <p className="mt-1 text-sm text-slate-600">{t("today.allClearBody")}</p>
            </Card>
          ) : null}

          {sections.map((section) => (
            <TaskSection
              key={section.key}
              id={`today-${section.key}`}
              title={`${t(section.title)} · ${section.rows.length}`}
              rows={section.rows}
            />
          ))}

          {quietLater.length > 0 ? (
            <TaskSection
              id="today-needs-update"
              title={`${t("today.needsUpdate")} · ${quietLater.length}`}
              description={t("today.needsUpdateLead")}
              rows={quietLater}
            />
          ) : null}

          {laterCount > 0 ? (
            <p className="text-sm text-slate-500">{t("today.later", { count: laterCount })}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function TaskSection({
  id,
  title,
  description,
  rows,
}: {
  id: string;
  title: string;
  description?: string;
  rows: TodayRowTask[];
}) {
  return (
    <section aria-labelledby={id}>
      <div id={id}>
        <SectionHeader title={title} description={description} />
      </div>
      <Card className="mt-2 overflow-hidden">
        <ul className="divide-y divide-slate-100">
          {rows.map((row) => (
            <TodayTaskRow key={row.id} task={row} />
          ))}
        </ul>
      </Card>
    </section>
  );
}

/**
 * Everything a row shows, decided here on the server: the due date in the
 * viewer's language, the blocked column's label, and whether the task has gone
 * quiet — so the client row only renders and reports.
 */
function rowFor(
  task: MyOpenTask,
  {
    t,
    dateLocale,
    today,
    overdue,
  }: { t: Translate; dateLocale: string; today: Date; overdue: boolean },
): TodayRowTask {
  const activity = activityOf(task);
  return {
    id: task.id,
    title: task.title,
    projectId: task.project.id,
    projectName: task.project.name,
    priority: task.priority,
    dueLabel: task.dueDate ? t("today.dueOn", { date: formatDay(task.dueDate, dateLocale) }) : null,
    overdue,
    blockedLabel: task.status.category === "blocked" ? displayStatusLabel(task.status, t) : null,
    staleDays: isStale(activity, today) ? daysSinceActivity(activity, today) : null,
  };
}
