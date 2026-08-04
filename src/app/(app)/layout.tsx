import { redirect } from "next/navigation";
import { getSessionUser, getOrCreateDefaultWorkspace } from "@/lib/auth-guard";
import { AppNav } from "@/components/app-nav";

/**
 * Auth boundary for every signed-in page. Unauthenticated visitors are
 * redirected here rather than in each page, and the workspace is provisioned
 * on first visit.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const workspace = await getOrCreateDefaultWorkspace(user);

  return (
    <div className="flex min-h-full flex-col">
      <AppNav
        workspaceName={workspace.workspaceName}
        userEmail={user.email}
        isAdmin={workspace.role === "admin"}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}
