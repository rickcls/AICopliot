import { z } from "zod";
import { confidenceSchema, projectCitationSchema } from "@/lib/schemas";

const itemSchema = z.object({
  kind: z.enum(["task", "milestone", "risk", "dependency"]),
  id: z.string(),
  title: z.string(),
  status: z.string(),
  date: z.string().nullable(),
  detail: z.string().nullable(),
  href: z.string().startsWith("/"),
});

export const savedStatusReportSchema = z.object({
  version: z.literal(1),
  project: z.object({ id: z.string(), name: z.string() }),
  observedAt: z.string().datetime(),
  period: z.object({
    start: z.iso.date(),
    end: z.iso.date(),
    upcomingStart: z.iso.date(),
    upcomingEnd: z.iso.date(),
  }),
  health: z.enum(["green", "amber", "red"]),
  counts: z.object({
    tasks: z.number().int().nonnegative(),
    openTasks: z.number().int().nonnegative(),
    completedTasksInPeriod: z.number().int().nonnegative(),
    milestones: z.number().int().nonnegative(),
    openMilestones: z.number().int().nonnegative(),
    completedMilestonesInPeriod: z.number().int().nonnegative(),
    activeRisks: z.number().int().nonnegative(),
    dependencyBlockers: z.number().int().nonnegative(),
    blockers: z.number().int().nonnegative(),
    overdue: z.number().int().nonnegative(),
    upcoming: z.number().int().nonnegative(),
  }),
  sections: z.object({
    completed: z.array(itemSchema),
    blockers: z.array(itemSchema),
    overdue: z.array(itemSchema),
    upcoming: z.array(itemSchema),
    risks: z.array(itemSchema),
    dependencyBlockers: z.array(itemSchema),
  }),
  narrative: z.string().min(1),
  confidence: confidenceSchema,
  citations: z.array(projectCitationSchema).min(1),
});

export type ParsedSavedStatusReport = z.infer<typeof savedStatusReportSchema>;
