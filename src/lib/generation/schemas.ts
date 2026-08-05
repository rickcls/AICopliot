import { z } from "zod";

/**
 * Document-to-plan contracts live outside the shared API schemas because they
 * are both larger and deliberately versioned with the generation prompt.
 */

export const MAX_SELECTED_DOCUMENTS = 20;
export const MAX_CONTEXT_CHUNKS = 48;
export const MAX_SCOPE_STATEMENTS = 20;
export const MAX_DELIVERABLES = 20;
export const MAX_ACCEPTANCE_CRITERIA = 20;
export const MAX_MILESTONES = 12;
export const MAX_TASKS = 40;
export const MAX_RISKS = 20;
export const MAX_DEPENDENCIES = 80;
export const MAX_REQUIREMENTS = 40;

const selectedDocumentIdsSchema = z
  .array(z.string().trim().min(1))
  .transform((ids) => [...new Set(ids)])
  .pipe(
    z
      .array(z.string())
      .min(1, "Select at least one ready document")
      .max(
        MAX_SELECTED_DOCUMENTS,
        `Select no more than ${MAX_SELECTED_DOCUMENTS} documents`,
      ),
  );

export const createGenerationRunSchema = z.object({
  documentIds: selectedDocumentIdsSchema,
});

export const createRequirementRunSchema = z.object({
  documentIds: selectedDocumentIdsSchema,
});

const sourceCitationSchema = z.object({
  sourceId: z.string().trim().min(1).max(20),
  quote: z.string().max(600).default(""),
});

const citedTextSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  citations: z.array(sourceCitationSchema).max(12).default([]),
});

const isoDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Invalid calendar date");

const optionalIsoDaySchema = isoDaySchema.nullable().default(null);

function localRefSchema(prefix: "M" | "T", maximum: number) {
  return z
    .string()
    .trim()
    .regex(new RegExp(`^${prefix}[1-9]\\d*$`, "i"))
    .refine((value) => {
      const number = Number(value.slice(1));
      return Number.isInteger(number) && number >= 1 && number <= maximum;
    }, `${prefix} reference is outside the allowed range`);
}

const milestoneRefSchema = localRefSchema("M", MAX_MILESTONES);
const taskRefSchema = localRefSchema("T", MAX_TASKS);

const milestoneProposalSchema = z.object({
  ref: milestoneRefSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).nullable().default(null),
  targetDate: optionalIsoDaySchema,
  status: z
    .enum(["not_started", "on_track", "at_risk", "blocked", "completed"])
    .default("not_started"),
  citations: z.array(sourceCitationSchema).max(12).default([]),
});

const taskProposalSchema = z.object({
  ref: taskRefSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).nullable().default(null),
  status: z
    .enum(["backlog", "todo", "in_progress", "blocked", "done"])
    .default("backlog"),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  startDate: optionalIsoDaySchema,
  dueDate: optionalIsoDaySchema,
  milestoneRef: milestoneRefSchema.nullable().default(null),
  citations: z.array(sourceCitationSchema).max(12).default([]),
  milestoneCitations: z.array(sourceCitationSchema).max(12).default([]),
});

const riskProposalSchema = z.object({
  description: z.string().trim().min(1).max(4000),
  impact: z.enum(["low", "medium", "high"]).default("medium"),
  likelihood: z.enum(["low", "medium", "high"]).default("medium"),
  mitigation: z.string().trim().max(4000).nullable().default(null),
  status: z.enum(["open", "monitoring", "mitigated", "accepted"]).default("open"),
  milestoneRef: milestoneRefSchema.nullable().default(null),
  citations: z.array(sourceCitationSchema).max(12).default([]),
  milestoneCitations: z.array(sourceCitationSchema).max(12).default([]),
});

const dependencyProposalSchema = z.object({
  taskRef: taskRefSchema,
  dependsOnTaskRef: taskRefSchema,
  citations: z.array(sourceCitationSchema).max(12).default([]),
});

/** Exact JSON shape requested from the model. Unknown keys are discarded. */
export const modelProjectPlanSchema = z.object({
  scopeStatements: z
    .array(citedTextSchema)
    .max(MAX_SCOPE_STATEMENTS)
    .default([]),
  deliverables: z.array(citedTextSchema).max(MAX_DELIVERABLES).default([]),
  acceptanceCriteria: z
    .array(citedTextSchema)
    .max(MAX_ACCEPTANCE_CRITERIA)
    .default([]),
  milestones: z.array(milestoneProposalSchema).max(MAX_MILESTONES).default([]),
  tasks: z.array(taskProposalSchema).max(MAX_TASKS).default([]),
  risks: z.array(riskProposalSchema).max(MAX_RISKS).default([]),
  dependencies: z
    .array(dependencyProposalSchema)
    .max(MAX_DEPENDENCIES)
    .default([]),
});

export type ModelProjectPlan = z.infer<typeof modelProjectPlanSchema>;

const requirementProposalSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).nullable().default(null),
  type: z
    .enum(["business", "functional", "non_functional", "constraint"])
    .default("functional"),
  priority: z.enum(["must", "should", "could", "wont"]).default("should"),
  acceptanceCriteria: z.string().trim().max(4000).nullable().default(null),
  assumptions: z.string().trim().max(4000).nullable().default(null),
  stakeholder: z.string().trim().max(200).nullable().default(null),
  // Defaults to `low` rather than `medium`: an omitted confidence means the
  // model did not commit to one, and under-claiming is the safe direction for a
  // record a human is about to take to the client.
  confidence: z.enum(["high", "medium", "low"]).default("low"),
  citations: z.array(sourceCitationSchema).max(12).default([]),
});

/** Exact JSON shape requested from the requirements-extraction prompt. */
export const modelRequirementsSchema = z.object({
  requirements: z
    .array(requirementProposalSchema)
    .max(MAX_REQUIREMENTS)
    .default([]),
});

export type ModelRequirements = z.infer<typeof modelRequirementsSchema>;
export type ModelRequirementProposal = z.infer<typeof requirementProposalSchema>;

const reviewItemSchema = z.object({
  kind: z.enum(["milestone", "task", "risk", "dependency"]),
  id: z.string().trim().min(1),
});

const reviewEditSchema = z.object({
  action: z.literal("edit"),
  item: reviewItemSchema,
  changes: z.record(z.string(), z.unknown()),
});

const reviewBatchSchema = z.object({
  action: z.enum(["approve", "reject"]),
  items: z.array(reviewItemSchema).min(1).max(160),
});

export const reviewGenerationRunSchema = z.discriminatedUnion("action", [
  reviewEditSchema,
  reviewBatchSchema,
]);

export type ReviewItem = z.infer<typeof reviewItemSchema>;

const nullableReviewDate = z
  .union([z.literal(""), isoDaySchema, z.null()])
  .optional()
  .transform((value) => (value === "" ? null : value));

const nullableReviewText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((value) => (typeof value === "string" && value === "" ? null : value));

const atLeastOne = (value: object) =>
  Object.values(value).some((field) => field !== undefined);

export const reviewTaskChangesSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: nullableReviewText(4000),
    status: z.enum(["backlog", "todo", "in_progress", "blocked", "done"]).optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    startDate: nullableReviewDate,
    dueDate: nullableReviewDate,
    milestoneId: z.string().trim().min(1).nullable().optional(),
  })
  .refine(atLeastOne, "Provide at least one field to update");

export const reviewMilestoneChangesSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: nullableReviewText(4000),
    targetDate: nullableReviewDate,
    status: z
      .enum(["not_started", "on_track", "at_risk", "blocked", "completed"])
      .optional(),
  })
  .refine(atLeastOne, "Provide at least one field to update");

export const reviewRiskChangesSchema = z
  .object({
    description: z.string().trim().min(1).max(4000).optional(),
    impact: z.enum(["low", "medium", "high"]).optional(),
    likelihood: z.enum(["low", "medium", "high"]).optional(),
    mitigation: nullableReviewText(4000),
    status: z.enum(["open", "monitoring", "mitigated", "accepted"]).optional(),
    milestoneId: z.string().trim().min(1).nullable().optional(),
  })
  .refine(atLeastOne, "Provide at least one field to update");

export const reviewDependencyChangesSchema = z
  .object({
    taskId: z.string().trim().min(1).optional(),
    dependsOnTaskId: z.string().trim().min(1).optional(),
  })
  .refine(atLeastOne, "Provide at least one field to update");

export function isoDayToDate(value: string | null | undefined) {
  if (value === undefined) return undefined;
  return value === null ? null : new Date(`${value}T00:00:00.000Z`);
}
