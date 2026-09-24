import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { PrintActions } from "@/components/print-actions";
import { getSessionUser, requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import {
  buildPack,
  PACK_TITLE,
  parsePackKind,
} from "@/lib/pm/requirements-export";
import { getScopedProject } from "@/lib/pm/project";
import { requirementSelect } from "@/lib/pm/select";
import { formatDay } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Requirements pack — ScopePilot" };

/**
 * A client-facing document: open questions, or the agreed scope to sign.
 *
 * Outside the (app) group on purpose, so there is no sidebar or tab strip to
 * hide — what is on screen is what prints, and "Save as PDF" gives the
 * consultant a file to email without any integration. The same `buildPack`
 * feeds the Markdown download, so the two cannot differ. Auth mirrors the app
 * layout: signed-out visitors go to /login, and the project is resolved inside
 * the caller's workspace.
 */
export default async function RequirementsPackPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ pack?: string | string[] }>;
}) {
  if (!(await getSessionUser())) redirect("/login");
  const { workspaceId } = await requireWorkspace();
  const [{ projectId }, { pack: packParam }] = await Promise.all([
    params,
    searchParams,
  ]);

  const kind = parsePackKind(packParam);
  const project = await getScopedProject(workspaceId, projectId);
  if (!kind || !project) notFound();

  const requirements = await prisma.requirement.findMany({
    where: { workspaceId, projectId: project.id },
    orderBy: { sequence: "asc" },
    select: requirementSelect,
  });
  const groups = buildPack(kind, requirements);
  const count = groups.reduce((total, group) => total + group.items.length, 0);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-8 print:max-w-none print:px-0 print:py-0">
      <PrintActions
        backHref={`/projects/${project.id}/requirements`}
        markdownHref={`/api/projects/${project.id}/requirements/export?format=md&pack=${kind}`}
      />

      <article className="mt-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm print:mt-0 print:border-0 print:p-0 print:shadow-none">
        <header className="border-b border-slate-200 pb-5">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            {project.name}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            {PACK_TITLE[kind]}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {formatDay(new Date())} · {count} item{count === 1 ? "" : "s"}
          </p>
          <p className="mt-3 text-sm text-pretty text-slate-700">
            {kind === "questions"
              ? "Each item below is something we understood from your documents but could not confirm. Please answer the point under each one."
              : "The requirements below are the agreed scope. Please review them and sign at the end to confirm."}
          </p>
        </header>

        {count === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            {kind === "questions"
              ? "There are no open questions for the client right now."
              : "Nothing has been agreed yet. Mark requirements Agreed in the register first."}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.heading ?? "unassigned"} className="mt-6">
              {group.heading ? (
                <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">
                  For {group.heading}
                </h2>
              ) : null}
              <ol className="space-y-5">
                {group.items.map((item) => (
                  <li key={item.code} className="break-inside-avoid">
                    <h3 className="text-base font-semibold text-slate-900">
                      <span className="mr-2 font-mono text-sm text-slate-500">
                        {item.code}
                      </span>
                      {item.title}
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500 uppercase">
                      {item.priority} · {item.type}
                    </p>
                    {item.description ? (
                      <p className="mt-2 text-sm text-pretty text-slate-700">
                        {item.description}
                      </p>
                    ) : null}
                    {item.question ? (
                      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        <span className="font-medium">To confirm: </span>
                        {item.question}
                        {/* Room for a handwritten or typed answer on paper. */}
                        <div className="mt-2 hidden h-12 border-b border-dashed border-amber-300 print:block" />
                      </div>
                    ) : null}
                    {item.acceptanceCriteria ? (
                      <p className="mt-2 text-sm text-slate-700">
                        <span className="font-medium">Acceptance: </span>
                        {item.acceptanceCriteria}
                      </p>
                    ) : null}
                    {item.evidence.length > 0 ? (
                      <p className="mt-1.5 text-xs text-slate-400 italic">
                        Source: {item.evidence.join("; ")}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>
          ))
        )}

        {kind === "signoff" && count > 0 ? (
          <footer className="mt-10 grid gap-8 border-t border-slate-200 pt-6 text-sm text-slate-700 sm:grid-cols-3 print:grid-cols-3">
            {["Approved by", "Role", "Date"].map((label) => (
              <div key={label}>
                <div className="h-10 border-b border-slate-400" />
                <p className="mt-1 text-xs text-slate-500">{label}</p>
              </div>
            ))}
          </footer>
        ) : null}
      </article>
    </main>
  );
}
