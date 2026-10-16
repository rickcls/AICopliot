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
import { useT } from "@/components/i18n-provider";
import { SectionToggle, type ProjectSection } from "@/components/section-toggle";
import type { MessageKey } from "@/lib/i18n/translate";
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

interface Section {
  path: string;
  labelKey: MessageKey;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}

// Core tabs are what every project is for: its work and its files. The other
// two groups are optional layers per project — requirements discovery
// (`Project.discoveryEnabled`) and delivery tracking (`deliveryEnabled`).
// A hidden layer is never deleted: its routes still resolve, so an old link
// lands with a notice and a way to turn it back on rather than a 404.
const CORE_SECTIONS: readonly Section[] = [
  { path: "", labelKey: "project.tabs.overview", icon: LayoutDashboard },
  { path: "/tasks", labelKey: "project.tabs.tasks", icon: SquareKanban },
  { path: "/documents", labelKey: "project.tabs.documents", icon: FileText },
];

const DISCOVERY_SECTIONS: readonly Section[] = [
  { path: "/requirements", labelKey: "project.tabs.requirements", icon: ListChecks },
];

const DELIVERY_SECTIONS: readonly Section[] = [
  { path: "/timeline", labelKey: "project.tabs.timeline", icon: GanttChartSquare },
  { path: "/risks", labelKey: "project.tabs.risks", icon: ShieldAlert },
  // The route stays /review; "Plan" says what the tab is for — generating a
  // delivery plan — rather than one step of using it.
  { path: "/review", labelKey: "project.tabs.plan", icon: Sparkles },
  { path: "/reports", labelKey: "project.tabs.reports", icon: FileBarChart },
];

function isUnder(activeSection: string, sections: readonly Section[]): boolean {
  return sections.some(
    (section) =>
      activeSection === section.path ||
      activeSection.startsWith(`${section.path}/`),
  );
}

export function ProjectTabs({
  projectId,
  deliveryEnabled,
  discoveryEnabled,
}: {
  projectId: string;
  deliveryEnabled: boolean;
  discoveryEnabled: boolean;
}) {
  const t = useT();
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

  const sections = [
    ...CORE_SECTIONS,
    ...(discoveryEnabled ? DISCOVERY_SECTIONS : []),
    ...(deliveryEnabled ? DELIVERY_SECTIONS : []),
  ];
  // Which switched-off layer the current page belongs to, if any.
  const hiddenLayer: ProjectSection | null =
    activeSection === null
      ? null
      : !discoveryEnabled && isUnder(activeSection, DISCOVERY_SECTIONS)
        ? "discovery"
        : !deliveryEnabled && isUnder(activeSection, DELIVERY_SECTIONS)
          ? "delivery"
          : null;

  return (
    <>
    <nav
      aria-label={t("project.sections")}
      // The strip scrolls sideways below `lg` rather than wrapping to a second
      // row: a two-row tab strip reads as two groups and hides which row the
      // active tab is on. `scrollbar-none` is deliberately not used — the bar is
      // the affordance telling you there is more to the right.
      className="-mx-4 overflow-x-auto border-b border-slate-200 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
    >
      <ul className="flex w-max min-w-full items-center gap-1">
        {sections.map((section) => {
          const active = activeSection === section.path;
          const Icon = section.icon;

          return (
            <li key={section.path}>
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
                {t(section.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
    {hiddenLayer ? (
      <div
        role="status"
        className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900"
      >
        <span>
          {t(
            hiddenLayer === "discovery"
              ? "project.hiddenDiscovery"
              : "project.hiddenDelivery",
          )}
        </span>
        <SectionToggle projectId={projectId} section={hiddenLayer} enabled={false} />
      </div>
    ) : null}
    </>
  );
}
