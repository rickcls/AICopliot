"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  ClipboardList,
  FileText,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Primary navigation. Always visible — never behind a toggle.
 *
 * Below `md` it narrows to an icon rail rather than disappearing, so the nav is
 * present at every width. Labels are hidden by CSS at that size, not
 * conditionally rendered, which keeps the markup identical between breakpoints
 * and avoids a hydration mismatch.
 *
 * This picks the *project*; the tab strip in the project layout picks the
 * section within it. The eight section links used to nest under the active
 * project here, which made the tree tall enough to overflow its own footer and
 * meant the answer to "where am I" was spread across two levels of one control.
 *
 * The active item comes from the pathname, because the layout rendering this
 * does not re-render on navigation.
 */

export interface SidebarProject {
  id: string;
  name: string;
}

const GLOBAL_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/documents", label: "All Documents", icon: FileText },
  { href: "/chat", label: "Ask", icon: MessageSquare },
] as const;

/** Hidden on the rail, shown once there is room for text. */
const LABEL = "hidden md:inline";

function NavItem({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      title={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg text-sm font-medium transition-colors",
        // Centred while it is an icon rail, left-aligned once labels appear.
        "justify-center px-2 py-2 md:justify-start md:px-3",
        active
          ? "bg-slate-900 text-white"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
      )}
    >
      <Icon className="size-4.5 shrink-0" />
      <span className={LABEL}>{label}</span>
    </Link>
  );
}

export function AppSidebar({
  projects,
  workspaceName,
  userEmail,
  isAdmin,
}: {
  projects: SidebarProject[];
  workspaceName: string;
  userEmail: string;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const activeProjectId = /^\/projects\/([^/]+)/.exec(pathname)?.[1];

  return (
    <aside className="sticky top-0 z-30 flex h-dvh w-14 shrink-0 flex-col border-r border-slate-200 bg-white md:w-64">
      <div className="flex h-14 shrink-0 items-center justify-center px-2 md:justify-start md:px-4">
        <Link href="/dashboard" title="ScopePilot — AI Project Delivery Copilot">
          <span className="text-sm font-semibold tracking-tight md:hidden">
            SP
          </span>
          <span className="hidden text-sm font-semibold tracking-tight md:inline">
            ScopePilot
          </span>
        </Link>
      </div>

      <nav
        aria-label="Main"
        // `min-h-0` is what lets this actually scroll: a column flex child
        // defaults to `min-height: auto`, so without it a long project list
        // grows past the rail and slides under the footer instead of scrolling.
        className="min-h-0 flex-1 space-y-5 overflow-x-hidden overflow-y-auto px-2 pb-4 md:px-3"
      >
        <ul className="space-y-1">
          {GLOBAL_LINKS.map((link) => (
            <li key={link.href}>
              <NavItem
                href={link.href}
                label={link.label}
                icon={link.icon}
                active={pathname === link.href}
              />
            </li>
          ))}
          {isAdmin ? (
            <li>
              <NavItem
                href="/admin/evaluations"
                label="Evaluations"
                icon={ClipboardList}
                active={pathname === "/admin/evaluations"}
              />
            </li>
          ) : null}
        </ul>

        {projects.length > 0 ? (
          <div>
            <p
              className={cn(
                "pb-1.5 text-xs font-semibold tracking-wide text-slate-400 uppercase",
                "hidden px-3 md:block",
              )}
            >
              Projects
            </p>
            {/* On the rail a divider stands in for the heading. */}
            <div className="mx-2 mb-2 border-t border-slate-200 md:hidden" />

            <ul className="space-y-0.5">
              {projects.map((project) => {
                const isActive = project.id === activeProjectId;
                return (
                  <li key={project.id}>
                    <Link
                      href={`/projects/${project.id}`}
                      title={project.name}
                      aria-current={isActive ? "true" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg text-sm transition-colors",
                        "justify-center px-2 py-2 md:justify-start md:px-2 md:py-1.5",
                        isActive
                          ? "bg-slate-100 font-semibold text-slate-900"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                      )}
                    >
                      {/* Initial stands in for the name on the rail, and gives
                          the row a fixed anchor once labels appear. */}
                      <span
                        aria-hidden
                        className={cn(
                          "grid size-5.5 shrink-0 place-items-center rounded-md text-[10px] font-semibold transition-colors",
                          isActive
                            ? "bg-slate-900 text-white"
                            : "bg-slate-200 text-slate-600",
                        )}
                      >
                        {project.name.charAt(0).toUpperCase()}
                      </span>
                      <span className={cn(LABEL, "truncate")}>
                        {project.name}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </nav>

      <div className="shrink-0 border-t border-slate-200 p-2 md:p-3">
        <div className="hidden md:block">
          <p className="truncate px-1 text-xs font-medium text-slate-900">
            {workspaceName}
          </p>
          <p className="truncate px-1 text-xs text-slate-500">{userEmail}</p>
        </div>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/" })}
          title={`Sign out (${userEmail})`}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900",
            "justify-center px-2 py-2 md:mt-2 md:justify-start md:px-1",
          )}
        >
          <LogOut className="size-4 shrink-0" aria-hidden />
          <span className={LABEL}>Sign out</span>
        </button>
      </div>
    </aside>
  );
}
