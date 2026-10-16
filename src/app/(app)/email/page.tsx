import { EmailComposer } from "@/components/email/email-composer";
import { WritingStyleCard } from "@/components/email/writing-style-card";
import { requireWorkspace } from "@/lib/auth-guard";
import { getCapture } from "@/lib/capture/service";
import { getWritingStyle, listEmailDrafts } from "@/lib/email/service";
import { getT } from "@/lib/i18n/server";
import { getMyOpenTasks } from "@/lib/pm/my-work";

export const dynamic = "force-dynamic";

/**
 * Email drafts in the person's tone. `?task=` preselects a task, which is how
 * the task panel's "Draft an email" lands here; `?capture=` opens a reply to an
 * email the person captured from Gmail, with that email as the incoming text.
 */
export default async function EmailPage({
  searchParams,
}: {
  searchParams: Promise<{ task?: string; capture?: string }>;
}) {
  const access = await requireWorkspace();
  const { task: requestedTask, capture: captureId } = await searchParams;
  const [t, tasks, drafts, style, capture] = await Promise.all([
    getT(),
    getMyOpenTasks(access.workspaceId, access.userId),
    listEmailDrafts(access),
    getWritingStyle(access.userId),
    // The caller's own capture only; anyone else's id resolves to nothing.
    captureId ? getCapture(access, captureId) : Promise.resolve(null),
  ]);
  const incoming = capture?.source === "email" ? capture.body : null;
  const options = tasks.map((task) => ({
    id: task.id,
    title: task.title,
    projectName: task.project.name,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("email.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">{t("email.lead")}</p>
      </div>
      <WritingStyleCard initial={style} />
      <EmailComposer
        tasks={options}
        initialTaskId={options.some((task) => task.id === requestedTask) ? requestedTask! : null}
        initialDrafts={drafts}
        initialIncoming={incoming}
      />
    </div>
  );
}
