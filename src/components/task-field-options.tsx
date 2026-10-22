import { Milestone, UserRound } from "lucide-react";
import { PriorityBadge } from "@/components/priority-badge";
import { ProjectMark } from "@/components/project-mark";
import { StatusTag, type PillOption } from "@/components/property-pill";
import {
  TASK_PRIORITIES,
  statusColorToken,
  type MemberOption,
  type MilestoneOption,
  type ProjectOption,
  type TaskStatusOption,
} from "@/components/task-types";
import { Avatar } from "@/components/ui";
import { displayStatusLabel } from "@/lib/i18n/status-labels";
import type { Translate } from "@/lib/i18n/translate";

/**
 * The menu options behind a task's pills, drawn the way each value looks
 * elsewhere — a column as its tag, a priority as its badge, a person with
 * their avatar — and shared by the detail panel and the form, so the two
 * cannot offer the same choice in two different shapes.
 */

export function statusOptions(statuses: TaskStatusOption[], t: Translate): PillOption[] {
  return statuses.map((status) => {
    const label = displayStatusLabel(status, t);
    return {
      value: status.id,
      label,
      content: <StatusTag tone={statusColorToken(status)} label={label} />,
    };
  });
}

export function priorityOptions(t: Translate): PillOption[] {
  return TASK_PRIORITIES.map((priority) => ({
    value: priority,
    label: t(`priority.${priority}`),
    content: <PriorityBadge priority={priority} />,
  }));
}

export function assigneeOptions(members: MemberOption[], t: Translate): PillOption[] {
  return [
    {
      value: "",
      label: t("common.unassigned"),
      content: (
        <>
          <span
            aria-hidden
            className="grid size-6 shrink-0 place-items-center rounded-full border border-dashed border-sand-300 text-sand-400"
          >
            <UserRound className="size-3.5" />
          </span>
          <span className="truncate text-sand-500">{t("common.unassigned")}</span>
        </>
      ),
    },
    ...members.map((member) => ({
      value: member.id,
      label: member.name,
      content: (
        <>
          <Avatar name={member.name} email={member.email} />
          <span className="truncate">{member.name}</span>
        </>
      ),
    })),
  ];
}

export function milestoneOptions(milestones: MilestoneOption[], t: Translate): PillOption[] {
  return [
    {
      value: "",
      label: t("common.none"),
      content: <span className="truncate text-sand-500">{t("common.none")}</span>,
    },
    ...milestones.map((milestone) => ({
      value: milestone.id,
      label: milestone.title,
      content: (
        <>
          <Milestone aria-hidden className="size-4 shrink-0 text-sand-400" />
          <span className="truncate">{milestone.title}</span>
        </>
      ),
    })),
  ];
}

export function projectOptions(projects: ProjectOption[]): PillOption[] {
  return projects.map((project) => ({
    value: project.id,
    label: project.name,
    content: (
      <>
        <ProjectMark id={project.id} name={project.name} personal={false} className="size-5 text-[10px]" />
        <span className="truncate">{project.name}</span>
      </>
    ),
  }));
}
