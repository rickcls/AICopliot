"use client";

import { X } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button, FilterChip, SearchField, Select } from "@/components/ui";
import {
  TASK_PRIORITIES,
  type MilestoneOption,
} from "@/components/task-types";
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
        <Select
          aria-label={t("tasks.filter.byPriority")}
          value={filter.priority ?? ""}
          onChange={(event) =>
            onChange({ ...filter, priority: event.target.value || null })
          }
          className="h-8 text-xs"
        >
          <option value="">{t("tasks.filter.anyPriority")}</option>
          {[...TASK_PRIORITIES].reverse().map((priority) => (
            <option key={priority} value={priority}>
              {t(`priority.${priority}`)}
            </option>
          ))}
        </Select>

        {milestones.length > 0 ? (
          <Select
            aria-label={t("tasks.filter.byMilestone")}
            value={filter.milestoneId ?? ""}
            onChange={(event) =>
              onChange({ ...filter, milestoneId: event.target.value || null })
            }
            className="h-8 max-w-48 text-xs"
          >
            <option value="">{t("tasks.filter.anyMilestone")}</option>
            <option value="none">{t("tasks.filter.noMilestone")}</option>
            {milestones.map((milestone) => (
              <option key={milestone.id} value={milestone.id}>
                {milestone.title}
              </option>
            ))}
          </Select>
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
