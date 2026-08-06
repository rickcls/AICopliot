"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  FileBarChart,
  FileText,
  GanttChartSquare,
  LayoutDashboard,
  ListChecks,
  ShieldAlert,
  Sparkles,
  SquareKanban,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Section navigation for one project.
 *
 * These links used to be nested inside the sidebar's project list. They moved
 * here because the sidebar answers *which project* and this strip answers
 * *which part of it* — two different questions that were being asked by one
 * control, at the cost of a nav tree deep enough to push its own footer off the
 * rail. The sidebar is still the only place a project is chosen, so there is
 * exactly one navigation per question rather than two competing ones.
 *
 * These are page links, not ARIA tabs: there is no tabpanel here, each one is a
 * real navigation to a separate route. Marking them up as a tablist would
 * promise assistive technology a widget that does not exist, so it is a `nav`
 * with `aria-current` instead.
 */

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

export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();

  // Everything after the project id, so `/projects/abc/tasks` resolves to
  // `/tasks` and the bare project route to `""`. Reading the section from the
  // pathname rather than a prop is what lets the layout render this once and
  // still have the right tab lit after a client-side navigation.
  const prefix = `/projects/${projectId}`;
  const activeSection = pathname.startsWith(prefix)
    ? pathname.slice(prefix.length)
    : null;

  /**
   * Below `lg` the strip is wider than the screen, so landing on Reports would
   * otherwise show a row of tabs with the active one off to the right and
   * nothing saying so — the strip would look like it had no selection at all.
   *
   * Both axes are `nearest`, which means "scroll the least that works, and
   * nothing at all if it already fits". `center` would re-centre the strip on
   * every navigation even at widths where every tab is visible, and the default
   * block alignment would drag the page down to meet the strip.
   */
  const activeTab = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    activeTab.current?.scrollIntoView({
      behavior: "instant",
      block: "nearest",
      inline: "nearest",
    });
  }, [activeSection]);

  return (
    <nav
      aria-label="Project sections"
      // The strip scrolls sideways below `lg` rather than wrapping to a second
      // row: a two-row tab strip reads as two groups and hides which row the
      // active tab is on. `scrollbar-none` is deliberately not used — the bar is
      // the affordance telling you there is more to the right.
      className="-mx-4 overflow-x-auto border-b border-slate-200 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
    >
      <ul className="flex w-max min-w-full items-center gap-1">
        {PROJECT_SECTIONS.map((section) => {
          const active = activeSection === section.path;
          const Icon = section.icon;

          return (
            <li key={section.label}>
              <Link
                href={`${prefix}${section.path}`}
                ref={active ? activeTab : undefined}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex items-center gap-2 whitespace-nowrap px-3 py-2.5 text-sm transition-colors",
                  // `-mb-px` pulls the underline onto the container's own border
                  // so the active tab joins the line rather than floating above it.
                  "-mb-px border-b-2",
                  active
                    ? "border-slate-900 font-semibold text-slate-900"
                    : "border-transparent font-medium text-slate-500 hover:border-slate-300 hover:text-slate-900",
                )}
              >
                <Icon
                  aria-hidden
                  className={cn(
                    "size-4 shrink-0 transition-colors",
                    active ? "text-slate-900" : "text-slate-400 group-hover:text-slate-600",
                  )}
                />
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
