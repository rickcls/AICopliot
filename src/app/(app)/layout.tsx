import { redirect } from "next/navigation";
import {
  getOrCreateDefaultWorkspace,
  getSessionUser,
  listMemberships,
} from "@/lib/auth-guard";
import { AppSidebar } from "@/components/app-sidebar";
import { ConfirmProvider } from "@/components/confirm-dialog";
import { ToastProvider } from "@/components/toast";
import { prisma } from "@/lib/db";
import { getLocale, getT } from "@/lib/i18n/server";
import { getOrCreatePersonalProject } from "@/lib/pm/personal-project";
import { visibleProjectWhere } from "@/lib/pm/visibility";

/**
 * Auth boundary for every signed-in page. Unauthenticated visitors are
 * redirected here rather than in each page, and the workspace — and the
 * person's personal project inside it — is provisioned on first visit. The
 * personal project costs no extra query once it exists: the project list read
 * below already shows whether it is there.
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
  const [t, locale, memberships, listed] = await Promise.all([
    getT(),
    getLocale(),
    listMemberships(user.id),
    prisma.project.findMany({
      where: visibleProjectWhere(workspace.workspaceId, user.id),
      orderBy: { name: "asc" },
      select: { id: true, name: true, personalOwnerId: true },
    }),
  ]);

  let personal = listed.find((project) => project.personalOwnerId === user.id);
  if (!personal) {
    const created = await getOrCreatePersonalProject(
      workspace.workspaceId,
      user,
      locale,
    );
    personal = { ...created, personalOwnerId: user.id };
  }
  // The personal project is pinned first; the rest stay alphabetical.
  const projects = [
    { id: personal.id, name: personal.name, personal: true },
    ...listed
      .filter((project) => project.id !== personal.id)
      .map((project) => ({ id: project.id, name: project.name, personal: false })),
  ];

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
          {t("app.skipToContent")}
        </a>
        {/* Always a row: the sidebar is present at every width, narrowing to an
            icon rail rather than collapsing behind a toggle. */}
        <div className="flex min-h-dvh">
          <AppSidebar
            projects={projects}
            workspaceId={workspace.workspaceId}
            workspaceName={workspace.workspaceName}
            workspaces={memberships}
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
