import { redirect } from "next/navigation";
import { getSessionUser, getOrCreateDefaultWorkspace } from "@/lib/auth-guard";
import { AppSidebar } from "@/components/app-sidebar";
import { ConfirmProvider } from "@/components/confirm-dialog";
import { ToastProvider } from "@/components/toast";
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
    // Providers wrap the shell rather than each panel: a confirmation is modal
    // over the whole page, and a toast outlives the component that raised it —
    // a delete confirmation is followed by that component unmounting.
    <ToastProvider>
      <ConfirmProvider>
        {/* The sidebar lists every project and, inside one, its eight sections.
            Without this, reaching page content by keyboard means tabbing past
            all of them again on every navigation. */}
        {/* `fixed` rather than `absolute`: nothing up to <body> is positioned,
            so an absolute link would anchor to the document and sit off-screen
            whenever the page is scrolled. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-slate-900 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
        >
          Skip to content
        </a>
        {/* Always a row: the sidebar is present at every width, narrowing to an
            icon rail rather than collapsing behind a toggle. */}
        <div className="flex min-h-dvh">
          <AppSidebar
            projects={projects}
            workspaceName={workspace.workspaceName}
            userEmail={user.email}
            isAdmin={workspace.role === "admin"}
          />
          <main
            id="main"
            className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
          >
            {children}
          </main>
        </div>
      </ConfirmProvider>
    </ToastProvider>
  );
}
