"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  ClipboardList,
  FileBarChart,
  FileText,
  FolderKanban,
  GanttChartSquare,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MessageSquare,
  ShieldAlert,
  Sparkles,
  SquareKanban,
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
 * The active item and the expanded project come from the pathname, because the
 * layout rendering this does not re-render on navigation.
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

// Requirements precedes Tasks because discovery precedes delivery: the register
// is where a project's scope is established before work is created from it.
const PROJECT_SECTIONS = [
  { path: "", label: "Overview", icon: LayoutDashboard },
  { path: "/requirements", label: "Requirements", icon: ListChecks },
  { path: "/tasks", label: "Tasks", icon: SquareKanban },
  { path: "/timeline", label: "Timeline", icon: GanttChartSquare },
  { path: "/documents", label: "Documents", icon: FileText },
  { path: "/risks", label: "Risks", icon: ShieldAlert },
  { path: "/review", label: "Review", icon: Sparkles },
  { path: "/reports", label: "Reports", icon: FileBarChart },
] as const;

/** Hidden on the rail, shown once there is room for text. */
const LABEL = "hidden md:inline";

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  nested,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  nested?: boolean;
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
        nested ? "md:py-1.5" : "",
        active
          ? "bg-slate-900 text-white"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
      )}
    >
      <Icon className={nested ? "size-4 shrink-0" : "size-4.5 shrink-0"} />
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
  const projectMatch = /^\/projects\/([^/]+)(\/[^/]*)?/.exec(pathname);
  const activeProjectId = projectMatch?.[1];
  const activeSection = projectMatch?.[2] ?? "";

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
        className="flex-1 space-y-5 overflow-x-hidden overflow-y-auto px-2 pb-4 md:px-3"
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

            <ul className="space-y-1">
              {projects.map((project) => {
                const isActive = project.id === activeProjectId;
                return (
                  <li key={project.id}>
                    <Link
                      href={`/projects/${project.id}`}
                      title={project.name}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg text-sm transition-colors",
                        "justify-center px-2 py-2 md:justify-start md:px-3 md:py-1.5",
                        isActive
                          ? "bg-slate-100 font-medium text-slate-900"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                      )}
                    >
                      {/* Initial stands in for the name on the rail. */}
                      <span
                        aria-hidden
                        className="grid size-5 shrink-0 place-items-center rounded bg-slate-200 text-[10px] font-semibold text-slate-600 md:hidden"
                      >
                        {project.name.charAt(0).toUpperCase()}
                      </span>
                      <span className={cn(LABEL, "truncate")}>
                        {project.name}
                      </span>
                    </Link>

                    {/* Sections only for the project you are in, so the sidebar
                        does not become a wall of links. */}
                    {isActive ? (
                      <ul className="mt-1 space-y-0.5 md:ml-3 md:border-l md:border-slate-200 md:pl-2">
                        {PROJECT_SECTIONS.map((section) => (
                          <li key={section.label}>
                            <NavItem
                              href={`/projects/${project.id}${section.path}`}
                              label={section.label}
                              icon={section.icon}
                              active={activeSection === section.path}
                              nested
                            />
                          </li>
                        ))}
                        <li>
                          <NavItem
                            href={`/chat?project=${project.id}`}
                            label="AI Chat"
                            icon={MessageSquare}
                            active={false}
                            nested
                          />
                        </li>
                      </ul>
                    ) : null}
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
