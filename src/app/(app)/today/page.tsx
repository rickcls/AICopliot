import {
  Ban,
  CalendarClock,
  CalendarPlus,
  CircleAlert,
  CircleCheck,
  ListTodo,
  MessageCircle,
  Sun,
} from "lucide-react";
import { CaptureWorkspace } from "@/components/capture/capture-workspace";
import { DayPlanCard } from "@/components/today/day-plan-card";
import { TodayTaskRow, type TodayRowTask } from "@/components/today/today-task-row";
import { Card, EmptyState, LinkButton, PageHeader, SectionHeader } from "@/components/ui";
import { getSessionUser, requireWorkspace } from "@/lib/auth-guard";
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
import { bucketMyTasks, undatedToShow } from "@/lib/pm/today";
import { greetingPeriod } from "@/lib/time";
import { getDayPlan } from "@/lib/today/plan-service";
import { formatDay } from "@/lib/utils";
import { getViewerTimeZone, getViewerToday } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/**
 * Home. Answers one question — what needs me now — across every project,
 * using the viewer's own calendar day so a task due today in Hong Kong is due
 * today here, not tomorrow until 08:00.
 *
 * Top to bottom: a greeting that says in one sentence what is waiting, tell
 * the assistant something (capture), the day's suggested order (plan), then
 * the work itself in buckets. Only buckets with something
 * in them are drawn. Work gone quiet is badged where it already appears, and
 * listed under "Needs an update" only when no other bucket shows it, so no
 * task is listed twice.
 */
export default async function TodayPage() {
  const access = await requireWorkspace();
  const { workspaceId, userId } = access;
  const today = await getViewerToday();
  const [t, locale, timeZone, user, solo, tasks, waiting, captureOptions, plan] = await Promise.all([
    getT(),
    getLocale(),
    getViewerTimeZone(),
    getSessionUser(),
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

  // The greeting reads the real clock in the viewer's zone; `today` is a
  // midnight date anchor and would always say "good evening".
  const greeting = t(`today.greeting.${greetingPeriod(timeZone, new Date())}`);
  const name = user?.name?.trim();
  const title = name ? t("today.greetingNamed", { greeting, name }) : greeting;
  const waitingOn = [
    buckets.overdue.length > 0 ? t("today.summary.overdue", { count: buckets.overdue.length }) : null,
    buckets.dueToday.length > 0 ? t("today.summary.dueToday", { count: buckets.dueToday.length }) : null,
    buckets.blocked.length > 0 ? t("today.summary.blocked", { count: buckets.blocked.length }) : null,
  ].filter((item): item is string => item !== null);
  const summary =
    waitingOn.length > 0
      ? t("today.summary.sentence", {
          items: new Intl.ListFormat(dateLocale, { type: "conjunction" }).format(waitingOn),
        })
      : t("today.allClearTitle");

  const toRow = (task: MyOpenTask, overdue: boolean) =>
    rowFor(task, { t, dateLocale, today, overdue });

  const allSections: {
    key: string;
    title: MessageKey;
    icon: React.ReactNode;
    rows: TodayRowTask[];
  }[] = [
    {
      key: "overdue",
      title: "today.overdue",
      icon: <CircleAlert className="size-4.5 text-red-600" />,
      rows: buckets.overdue.map((task) => toRow(task, true)),
    },
    {
      key: "dueToday",
      title: "today.dueToday",
      icon: <Sun className="size-4.5 text-brand-600" />,
      rows: buckets.dueToday.map((task) => toRow(task, false)),
    },
    {
      key: "blocked",
      title: "today.blocked",
      icon: <Ban className="size-4.5 text-sand-500" />,
      rows: buckets.blocked.map((task) => toRow(task, false)),
    },
    {
      key: "dueSoon",
      title: "today.dueSoon",
      icon: <CalendarClock className="size-4.5 text-sand-500" />,
      rows: buckets.dueSoon.map((task) => toRow(task, false)),
    },
  ];
  const sections = allSections.filter((section) => section.rows.length > 0);
  const quietLater = buckets.later
    .map((task) => toRow(task, false))
    .filter((row) => row.staleDays !== null);
  const quietIds = new Set(quietLater.map((row) => row.id));
  const undatedLater = buckets.later.filter((task) => !quietIds.has(task.id));
  const undatedCount = undatedLater.filter((task) => task.dueDate === null).length;
  const undatedRows = undatedToShow(undatedLater).map((task) => toRow(task, false));
  const laterCount = buckets.later.length - quietLater.length - undatedRows.length;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={title}
        lead={
          <>
            <p>
              <span className="font-medium text-sand-900">{heading}</span>
              <span aria-hidden className="mx-2 text-sand-300">
                ·
              </span>
              {summary}
            </p>
            <p className="mt-1 text-sm text-sand-500">
              {solo ? t("today.soloLead") : t("today.lead")}
            </p>
          </>
        }
      />

      <div className="mb-10">
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
          icon={<ListTodo className="size-5" />}
          title={t("today.noTasksTitle")}
          description={t("today.noTasksBody")}
          action={<LinkButton href="/projects">{t("today.openProjects")}</LinkButton>}
        />
      ) : (
        <div className="space-y-10">
          {/* Keyed on the plan's marks: a check-in anywhere on the page refreshes
              the server data, and the card then starts again from it. */}
          <DayPlanCard
            key={plan ? `${plan.updatedAt}:${plan.items.map((item) => item.state).join("")}` : "none"}
            initialPlan={plan}
          />

          {sections.length === 0 && quietLater.length === 0 && undatedRows.length === 0 ? (
            <Card className="flex items-start gap-4 p-6">
              <span
                aria-hidden
                className="grid size-10 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600"
              >
                <CircleCheck className="size-5" />
              </span>
              <div>
                <h2 className="text-base font-semibold text-sand-900">
                  {t("today.allClearTitle")}
                </h2>
                <p className="mt-1 text-sm text-sand-600">{t("today.allClearBody")}</p>
              </div>
            </Card>
          ) : null}

          {sections.map((section) => (
            <TaskSection
              key={section.key}
              id={`today-${section.key}`}
              title={t(section.title)}
              icon={section.icon}
              rows={section.rows}
            />
          ))}

          {quietLater.length > 0 ? (
            <TaskSection
              id="today-needs-update"
              title={t("today.needsUpdate")}
              icon={<MessageCircle className="size-4.5 text-amber-600" />}
              description={t("today.needsUpdateLead")}
              rows={quietLater}
            />
          ) : null}

          {undatedRows.length > 0 ? (
            <TaskSection
              id="today-undated"
              title={t("today.undatedTitle")}
              icon={<CalendarPlus className="size-4.5 text-sand-500" />}
              count={undatedCount}
              description={t("today.undatedLead")}
              rows={undatedRows}
            />
          ) : null}

          {laterCount > 0 ? (
            <p className="text-sm text-sand-500">{t("today.later", { count: laterCount })}</p>
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
  icon,
  count,
  rows,
}: {
  id: string;
  title: string;
  description?: string;
  icon: React.ReactNode;
  /** Defaults to the rows shown; "No due date" counts more than it lists. */
  count?: number;
  rows: TodayRowTask[];
}) {
  return (
    <section aria-labelledby={id}>
      <div id={id}>
        <SectionHeader
          title={title}
          description={description}
          icon={icon}
          count={count ?? rows.length}
        />
      </div>
      <Card className="mt-3 overflow-hidden">
        <ul className="divide-y divide-sand-100">
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
