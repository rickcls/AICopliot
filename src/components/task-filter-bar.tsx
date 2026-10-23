"use client";

import { Milestone, X } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { PRIORITY_TONE, PriorityIcon } from "@/components/priority-badge";
import { PILL_NEUTRAL, PillSelect } from "@/components/property-pill";
import { milestoneOptions, priorityOptions } from "@/components/task-field-options";
import { Button, FilterChip, SearchField } from "@/components/ui";
import type { MilestoneOption, TaskPriority } from "@/components/task-types";
import {
  EMPTY_TASK_FILTER,
  isTaskFilterActive,
  TASK_QUICK_FILTERS,
  type TaskFilter,
  type TaskQuickFilter,
} from "@/lib/pm/filters";

/**
 * One filter bar for both board and list views, so switching view never loses
 * what you were looking at.
 *
 * Quick filters are mutually exclusive on purpose: "overdue" and "due soon"
 * partition open work, so allowing both at once would always be empty.
 */
export function TaskFilterBar({
  filter,
  onChange,
  counts,
  milestones,
  shown,
  total,
}: {
  filter: TaskFilter;
  onChange: (filter: TaskFilter) => void;
  counts: Record<TaskQuickFilter, number>;
  milestones: MilestoneOption[];
  shown: number;
  total: number;
}) {
  const active = isTaskFilterActive(filter);
  const t = useT();

  return (
    <div
      role="search"
      aria-label={t("tasks.filter.label")}
      className="flex flex-wrap items-center gap-x-3 gap-y-2"
    >
      <SearchField
        label={t("tasks.filter.search")}
        placeholder={t("tasks.filter.search")}
        value={filter.query}
        onChange={(event) => onChange({ ...filter, query: event.target.value })}
        className="w-full sm:w-56"
      />

      <div className="flex flex-wrap items-center gap-1.5">
        {TASK_QUICK_FILTERS.map((quick) => (
          <FilterChip
            key={quick}
            pressed={filter.quick === quick}
            count={counts[quick]}
            tone={quick === "overdue" ? "danger" : "neutral"}
            onClick={() =>
              onChange({
                ...filter,
                quick: filter.quick === quick ? null : quick,
              })
            }
          >
            {t(`taskQuickFilter.${quick}`)}
          </FilterChip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <PillSelect
          aria-label={t("tasks.filter.byPriority")}
          tone={filter.priority ? PRIORITY_TONE[filter.priority as TaskPriority] : PILL_NEUTRAL}
          icon={filter.priority ? <PriorityIcon priority={filter.priority as TaskPriority} /> : undefined}
          className="h-7 text-xs"
          value={filter.priority ?? ""}
          options={[
            { value: "", label: t("tasks.filter.anyPriority") },
            ...[...priorityOptions(t)].reverse(),
          ]}
          onValueChange={(priority) => onChange({ ...filter, priority: priority || null })}
        />

        {milestones.length > 0 ? (
          <PillSelect
            aria-label={t("tasks.filter.byMilestone")}
            icon={<Milestone className="size-3.5 opacity-70" />}
            className="h-7 max-w-48 text-xs"
            value={filter.milestoneId ?? ""}
            options={[
              { value: "", label: t("tasks.filter.anyMilestone") },
              { value: "none", label: t("tasks.filter.noMilestone") },
              ...milestoneOptions(milestones, t).slice(1),
            ]}
            onValueChange={(milestoneId) => onChange({ ...filter, milestoneId: milestoneId || null })}
          />
        ) : null}

        {active ? (
          <>
            <span className="text-xs text-sand-500 tabular-nums" aria-live="polite">
              {t("tasks.filter.shown", { shown, total })}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onChange(EMPTY_TASK_FILTER)}
            >
              <X className="size-3.5" aria-hidden />
              {t("common.clear")}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
