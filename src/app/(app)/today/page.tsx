import Link from "next/link";
import { Flag } from "lucide-react";
import { PRIORITY_FLAG } from "@/components/task-types";
import { Card, EmptyState, LinkButton, SectionHeader } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth-guard";
import { intlLocale } from "@/lib/i18n/locales";
import { getLocale, getT } from "@/lib/i18n/server";
import { displayStatusLabel } from "@/lib/i18n/status-labels";
import type { MessageKey, Translate } from "@/lib/i18n/translate";
import { getMyOpenTasks, isSoloWorkspace, type MyOpenTask } from "@/lib/pm/my-work";
import { bucketMyTasks } from "@/lib/pm/today";
import { cn, formatDay } from "@/lib/utils";
import { getViewerToday } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/**
 * Home. Answers one question — what needs me now — across every project,
 * using the viewer's own calendar day so a task due today in Hong Kong is due
 * today here, not tomorrow until 08:00.
 *
 * Only buckets with something in them are drawn: four headings over "nothing
 * here" would be the page shouting about good news.
 */
export default async function TodayPage() {
  const { workspaceId, userId } = await requireWorkspace();
  const [t, locale, today, solo, tasks] = await Promise.all([
    getT(),
    getLocale(),
    getViewerToday(),
    isSoloWorkspace(workspaceId),
    getMyOpenTasks(workspaceId, userId),
  ]);

  const dateLocale = intlLocale(locale);
  // `today` is UTC midnight of the viewer's date, so formatting it in UTC
  // prints that date whatever zone the server runs in.
  const heading = new Intl.DateTimeFormat(dateLocale, {
    dateStyle: "full",
    timeZone: "UTC",
  }).format(today);

  const buckets = bucketMyTasks(tasks, today);
  const allSections: { key: string; title: MessageKey; tasks: MyOpenTask[] }[] = [
    { key: "overdue", title: "today.overdue", tasks: buckets.overdue },
    { key: "dueToday", title: "today.dueToday", tasks: buckets.dueToday },
    { key: "blocked", title: "today.blocked", tasks: buckets.blocked },
    { key: "dueSoon", title: "today.dueSoon", tasks: buckets.dueSoon },
  ];
  const sections = allSections.filter((section) => section.tasks.length > 0);

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

      {tasks.length === 0 ? (
        <EmptyState
          title={t("today.noTasksTitle")}
          description={t("today.noTasksBody")}
          action={<LinkButton href="/projects">{t("today.openProjects")}</LinkButton>}
        />
      ) : (
        <div className="space-y-6">
          {sections.length === 0 ? (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-slate-900">
                {t("today.allClearTitle")}
              </h2>
              <p className="mt-1 text-sm text-slate-600">{t("today.allClearBody")}</p>
            </Card>
          ) : (
            sections.map((section) => (
              <section key={section.key} aria-labelledby={`today-${section.key}`}>
                <div id={`today-${section.key}`}>
                  <SectionHeader
                    title={`${t(section.title)} · ${section.tasks.length}`}
                  />
                </div>
                <Card className="mt-2 overflow-hidden">
                  <ul className="divide-y divide-slate-100">
                    {section.tasks.map((task) => (
                      <TodayRow
                        key={task.id}
                        task={task}
                        t={t}
                        dateLocale={dateLocale}
                        overdue={section.key === "overdue"}
                      />
                    ))}
                  </ul>
                </Card>
              </section>
            ))
          )}

          {buckets.later.length > 0 ? (
            <p className="text-sm text-slate-500">
              {t("today.later", { count: buckets.later.length })}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * One line per task: priority flag, title, project, and the date or status
 * that put it in this bucket. Opens the task in its own project's board.
 */
function TodayRow({
  task,
  t,
  dateLocale,
  overdue,
}: {
  task: MyOpenTask;
  t: Translate;
  dateLocale: string;
  overdue: boolean;
}) {
  const priority = t(`priority.${task.priority}`);
  const blocked = task.status.category === "blocked";

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 sm:flex-nowrap">
      <span title={t("priority.flag", { level: priority })} className="shrink-0">
        <span className="sr-only">{t("priority.flag", { level: priority })}</span>
        <Flag
          aria-hidden
          fill="currentColor"
          className={cn("size-3.5", PRIORITY_FLAG[task.priority])}
        />
      </span>
      <Link
        href={`/projects/${task.project.id}/tasks?task=${task.id}`}
        className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 hover:underline"
      >
        {task.title}
      </Link>
      <span className="flex shrink-0 items-center gap-3 text-xs text-slate-500">
        {blocked ? (
          <span className="font-medium text-red-700">
            {displayStatusLabel(task.status, t)}
          </span>
        ) : null}
        <span className="max-w-40 truncate">{task.project.name}</span>
        {task.dueDate ? (
          <span
            className={cn(
              "tabular-nums",
              overdue ? "font-medium text-red-700" : undefined,
            )}
          >
            {t("today.dueOn", { date: formatDay(task.dueDate, dateLocale) })}
          </span>
        ) : null}
      </span>
    </li>
  );
}
