import Link from "next/link";
import { DashboardSummary } from "@/components/dashboard-summary";
import { EmptyState } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Workspace summary. Document administration lives at /documents so the
 * sidebar entry labelled "All Documents" leads to documents and nothing else.
 */
export default async function DashboardPage() {
  const { workspaceId, workspaceName } = await requireWorkspace();

  const [projectCount, documentCount] = await Promise.all([
    prisma.project.count({ where: { workspaceId } }),
    prisma.document.count({ where: { workspaceId } }),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {workspaceName}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {projectCount} project{projectCount === 1 ? "" : "s"} ·{" "}
          {documentCount} document{documentCount === 1 ? "" : "s"}
        </p>
      </div>

      <DashboardSummary workspaceId={workspaceId} />

      {projectCount === 0 ? (
        <EmptyState
          title="Nothing here yet"
          description="Create a project to hold its documents, tasks, milestones, and risks. Everything on this page is a summary of work across your projects."
          action={
            <Link
              href="/projects"
              className="inline-flex h-10 items-center rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700"
            >
              Create a project
            </Link>
          }
        />
      ) : null}
    </div>
  );
}
