import { redirect } from "next/navigation";
import { getSessionUser, getOrCreateDefaultWorkspace } from "@/lib/auth-guard";
import { AppSidebar } from "@/components/app-sidebar";
import { prisma } from "@/lib/db";

/**
 * Auth boundary for every signed-in page. Unauthenticated visitors are
 * redirected here rather than in each page, and the workspace is provisioned
 * on first visit.
 *
 * The shell is full width: the board and Gantt need the room, and the previous
 * max-w-5xl cap was what squeezed five board columns into ~180px each.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const workspace = await getOrCreateDefaultWorkspace(user);

  const projects = await prisma.project.findMany({
    where: { workspaceId: workspace.workspaceId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    // Always a row: the sidebar is present at every width, narrowing to an icon
    // rail rather than collapsing behind a toggle.
    <div className="flex min-h-dvh">
      <AppSidebar
        projects={projects}
        workspaceName={workspace.workspaceName}
        userEmail={user.email}
        isAdmin={workspace.role === "admin"}
      />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {children}
      </main>

    </div>
  );
}
