"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Bot,
  CalendarCheck,
  ClipboardList,
  FileText,
  FolderKanban,
  LogOut,
  Mail,
  MessageSquare,
  NotebookPen,
  Settings,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/brand-mark";
import { useT } from "@/components/i18n-provider";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, FOCUS_RING, identityTone } from "@/components/ui";
import {
  WorkspaceSwitcher,
  type WorkspaceOption,
} from "@/components/workspace-switcher";

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
  /** The viewer's own personal project, pinned first with its own mark. */
  personal: boolean;
}

// Today is first because it is home: the question this app answers first is
// "what needs me now". The workspace-wide dashboard is reached from Projects
// as "Workspace overview" — one question, one entry.
const GLOBAL_LINKS = [
  { href: "/today", labelKey: "nav.today", icon: CalendarCheck },
  { href: "/capture", labelKey: "nav.capture", icon: NotebookPen },
  { href: "/assistant", labelKey: "nav.assistant", icon: Bot },
  { href: "/projects", labelKey: "nav.projects", icon: FolderKanban },
  { href: "/documents", labelKey: "nav.documents", icon: FileText },
  // Ask keeps its highlight on /chat/<conversationId>, because a thread has no
  // other entry in this nav. It is deliberately not a blanket prefix rule: on
  // /projects/<id> the project row below already carries aria-current, and a
  // second one on "Projects" would announce two current pages in one nav.
  { href: "/chat", labelKey: "nav.ask", icon: MessageSquare, matchChildren: true },
  { href: "/email", labelKey: "nav.email", icon: Mail },
] as const;

/** Hidden on the rail, shown once there is room for text. */
const LABEL = "hidden md:inline";

/**
 * The current page is a soft terracotta tint, the same "selected" language as
 * a pressed filter chip (one step deeper, since the rail is tinted itself). It used to be a solid black block, the loudest thing
 * on screen, on the one item the viewer already knows they are on. A tint also
 * holds up in the dark theme, where a white "raised" row would sit only a step
 * away from the rail behind it.
 */
const CURRENT = "bg-brand-100/70 text-brand-800";
const AT_REST = "text-sand-600 hover:bg-sand-200/60 hover:text-sand-900";

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  className,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      title={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-2.5 rounded-xl text-sm font-medium transition-colors",
        FOCUS_RING,
        // Centred while it is an icon rail, left-aligned once labels appear.
        "justify-center px-2 py-2 md:justify-start md:px-3",
        active ? CURRENT : AT_REST,
        className,
      )}
    >
      <Icon
        className={cn(
          "size-4.5 shrink-0 transition-colors",
          active ? "text-brand-600" : "text-sand-500 group-hover:text-sand-700",
        )}
      />
      <span className={LABEL}>{label}</span>
    </Link>
  );
}

export function AppSidebar({
  projects,
  workspaceId,
  workspaceName,
  workspaces,
  userName,
  userEmail,
  isAdmin,
}: {
  projects: SidebarProject[];
  workspaceId: string;
  workspaceName: string;
  /** Every workspace the viewer belongs to; a switcher appears with two or more. */
  workspaces: WorkspaceOption[];
  userName: string | null;
  userEmail: string;
  isAdmin: boolean;
}) {
  const t = useT();
  const pathname = usePathname();
  const activeProjectId = /^\/projects\/([^/]+)/.exec(pathname)?.[1];

  return (
    // A tinted surface rather than a white panel behind a hard rule: the rail
    // reads as the edge of the desk, and the page as the paper on it.
    <aside className="sticky top-0 z-30 flex h-dvh w-14 shrink-0 flex-col border-r border-sand-200/60 bg-sand-100/70 md:w-64">
      <div className="flex h-16 shrink-0 items-center justify-center px-2 md:justify-start md:px-5">
        <Link
          href="/today"
          title={`${t("app.name")} — ${t("app.tagline")}`}
          className={cn("flex items-center gap-2.5 rounded-lg", FOCUS_RING)}
        >
          <BrandMark />
          <span className="hidden text-[15px] font-semibold tracking-tight text-sand-900 md:inline">
            ScopePilot
          </span>
          <span className="sr-only md:hidden">ScopePilot</span>
        </Link>
      </div>

      <nav
        aria-label={t("nav.main")}
        // `min-h-0` is what lets this actually scroll: a column flex child
        // defaults to `min-height: auto`, so without it a long project list
        // grows past the rail and slides under the footer instead of scrolling.
        className="min-h-0 flex-1 space-y-6 overflow-x-hidden overflow-y-auto px-2 pt-1 pb-4 md:px-3"
      >
        <ul className="space-y-1">
          {GLOBAL_LINKS.map((link) => (
            <li key={link.href}>
              <NavItem
                href={link.href}
                label={t(link.labelKey)}
                icon={link.icon}
                active={
                  pathname === link.href ||
                  ("matchChildren" in link &&
                    pathname.startsWith(`${link.href}/`))
                }
              />
            </li>
          ))}
          {isAdmin ? (
            <li>
              <NavItem
                href="/admin/evaluations"
                label={t("nav.evaluations")}
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
                "pb-2 text-xs font-semibold tracking-wide text-sand-500 uppercase",
                "hidden px-3 md:block",
              )}
            >
              {t("nav.projectsHeading")}
            </p>
            {/* On the rail a divider stands in for the heading. */}
            <div className="mx-2 mb-2 border-t border-sand-200/80 md:hidden" />

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
                        "flex items-center gap-2.5 rounded-xl text-sm transition-colors",
                        FOCUS_RING,
                        "justify-center px-2 py-2 md:justify-start md:px-2.5 md:py-1.5",
                        isActive ? cn(CURRENT, "font-semibold") : AT_REST,
                      )}
                    >
                      {/* Initial stands in for the name on the rail, and gives
                          the row a fixed anchor once labels appear. Its colour
                          comes from the project's id, so a project keeps its
                          colour wherever it is listed. The personal project
                          carries a person mark instead, so it reads as "mine"
                          even on the rail. */}
                      <span
                        aria-hidden
                        className={cn(
                          "grid size-6 shrink-0 place-items-center rounded-lg text-[11px] font-semibold",
                          project.personal
                            ? "bg-brand-100 text-brand-700"
                            : identityTone(project.id),
                        )}
                      >
                        {project.personal ? (
                          <UserRound className="size-3.5" />
                        ) : (
                          project.name.charAt(0).toUpperCase()
                        )}
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

      <div className="shrink-0 border-t border-sand-200/80 p-2 md:p-3">
        <div className="hidden space-y-3 md:block">
          <div className="flex items-center gap-2.5 px-1">
            <Avatar name={userName} email={userEmail} className="size-8 text-xs" />
            <div className="min-w-0 flex-1">
              {workspaces.length > 1 ? (
                <WorkspaceSwitcher current={workspaceId} workspaces={workspaces} />
              ) : (
                <p className="truncate text-sm font-medium text-sand-900">
                  {workspaceName}
                </p>
              )}
              <p className="truncate text-xs text-sand-500">{userName ?? userEmail}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <ThemeToggle />
            <LocaleSwitcher />
          </div>
        </div>
        <NavItem
          href="/settings"
          label={t("nav.settings")}
          icon={Settings}
          active={pathname === "/settings"}
          className="md:mt-2"
        />
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/" })}
          title={t("nav.signOutAs", { email: userEmail })}
          className={cn(
            "group flex w-full items-center gap-2.5 rounded-xl text-sm font-medium transition-colors",
            AT_REST,
            FOCUS_RING,
            "justify-center px-2 py-2 md:justify-start md:px-3",
          )}
        >
          <LogOut
            className="size-4.5 shrink-0 text-sand-500 transition-colors group-hover:text-sand-700"
            aria-hidden
          />
          <span className={LABEL}>{t("nav.signOut")}</span>
        </button>
      </div>
    </aside>
  );
}
