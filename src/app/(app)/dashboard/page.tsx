import { Suspense } from "react";
import { DashboardSummary } from "@/components/dashboard-summary";
import {
  Card,
  EmptyState,
  LinkButton,
  Skeleton,
  SkeletonRegion,
} from "@/components/ui";
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

      {/* With no projects, four zero cards above an empty state say the same
          thing five times; the empty state alone says it once. */}
      {projectCount === 0 ? (
        <EmptyState
          title="Nothing here yet"
          description="Create a project to hold its documents, tasks, milestones, and risks. Everything on this page is a summary of work across your projects."
          action={<LinkButton href="/projects">Create a project</LinkButton>}
        />
      ) : (
        // The summary is the slow half of the page (a dozen grouped reads), so
        // the heading streams first instead of waiting on all of it.
        <Suspense fallback={<SummarySkeleton />}>
          <DashboardSummary workspaceId={workspaceId} />
        </Suspense>
      )}
    </div>
  );
}

function SummarySkeleton() {
  return (
    <SkeletonRegion label="Loading summary" className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 bg-slate-100" />
        ))}
      </div>
      <Card className="p-5">
        <div className="space-y-3">
          <Skeleton className="h-4 w-full bg-slate-100" />
          <Skeleton className="h-4 w-11/12 bg-slate-100" />
          <Skeleton className="h-4 w-4/5 bg-slate-100" />
        </div>
      </Card>
    </SkeletonRegion>
  );
}
