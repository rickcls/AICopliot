import { Suspense } from "react";
import { DashboardSummary } from "@/components/dashboard-summary";
import {
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  Skeleton,
  SkeletonRegion,
} from "@/components/ui";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { visibleProjectWhere } from "@/lib/pm/visibility";

export const dynamic = "force-dynamic";

/**
 * Workspace overview: a summary across every project and every member, reached
 * from the Projects page. Home is /today, which answers the narrower question
 * of what needs the viewer. Document administration lives at /documents.
 */
export default async function DashboardPage() {
  const { workspaceId, workspaceName, userId } = await requireWorkspace();
  const t = await getT();

  const [projectCount, documentCount] = await Promise.all([
    prisma.project.count({ where: visibleProjectWhere(workspaceId, userId) }),
    prisma.document.count({ where: { workspaceId } }),
  ]);

  return (
    <div>
      <PageHeader
        title={t("dashboard.title")}
        lead={
          <>
            <span className="font-medium text-sand-900">{workspaceName}</span> ·{" "}
            {t("workspaceOverview.counts", {
              projects: t("workspaceOverview.projects", { count: projectCount }),
              documents: t("workspaceOverview.documents", { count: documentCount }),
            })}
          </>
        }
      />

      {/* With no projects, four zero cards above an empty state say the same
          thing five times; the empty state alone says it once. */}
      {projectCount === 0 ? (
        <EmptyState
          title={t("workspaceOverview.emptyTitle")}
          description={t("workspaceOverview.emptyBody")}
          action={
            <LinkButton href="/projects">{t("workspaceOverview.createProject")}</LinkButton>
          }
        />
      ) : (
        // The summary is the slow half of the page (a dozen grouped reads), so
        // the heading streams first instead of waiting on all of it.
        <Suspense fallback={<SummarySkeleton label={t("workspaceOverview.loading")} />}>
          <DashboardSummary workspaceId={workspaceId} viewerId={userId} />
        </Suspense>
      )}
    </div>
  );
}

function SummarySkeleton({ label }: { label: string }) {
  return (
    <SkeletonRegion label={label} className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 bg-sand-100" />
        ))}
      </div>
      <Card className="p-5">
        <div className="space-y-3">
          <Skeleton className="h-4 w-full bg-sand-100" />
          <Skeleton className="h-4 w-11/12 bg-sand-100" />
          <Skeleton className="h-4 w-4/5 bg-sand-100" />
        </div>
      </Card>
    </SkeletonRegion>
  );
}
