import { z } from "zod";

/** Every API input and the model's JSON output are validated through this file. */

// --- Model output contract -------------------------------------------------

export const confidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof confidenceSchema>;

/**
 * What the LLM must return. `sourceId` refers to the opaque S1..Sn labels we
 * put in the prompt, never a database ID — validated against the retrieved set
 * in src/lib/rag/citations.ts.
 */
export const modelAnswerSchema = z.object({
  answer: z.string().min(1),
  confidence: confidenceSchema,
  insufficientContext: z.boolean().default(false),
  citations: z
    .array(
      z.object({
        sourceId: z.string().min(1),
        quote: z.string().max(600).default(""),
      }),
    )
    .default([]),
});
export type ModelAnswer = z.infer<typeof modelAnswerSchema>;

/**
 * The opaque prompt label this citation was returned under ("S1", "Q3") — never
 * a database ID, so invariant 3 is untouched. Optional because every row
 * persisted to `ChatMessage.citations` before this field existed lacks the key,
 * and replaying a stored thread must keep parsing them.
 */
const citationLabel = z.string().optional();

const documentCitationSchema = z.object({
  kind: z.literal("document"),
  label: citationLabel,
  chunkId: z.string(),
  documentId: z.string(),
  filename: z.string(),
  pageNumber: z.number().int().nullable(),
  sectionTitle: z.string().nullable(),
  excerpt: z.string(),
  score: z.number(),
  matchType: z.enum(["semantic", "lexical", "hybrid"]).optional(),
});

const projectCitationKindSchema = z.enum([
  "task",
  "milestone",
  "risk",
  "dependency",
  "requirement",
  "project_snapshot",
]);

export const projectCitationSchema = z.object({
  kind: projectCitationKindSchema,
  label: citationLabel,
  title: z.string(),
  excerpt: z.string(),
  observedAt: z.string().datetime(),
  href: z.string().startsWith("/"),
  snapshot: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  ),
});

/** Citation as rendered to the user, resolved back to a frozen source record. */
export const citationSchema = z.discriminatedUnion("kind", [
  documentCitationSchema,
  projectCitationSchema,
]);

export interface DocumentCitation extends z.infer<typeof documentCitationSchema> {
  title?: never;
  observedAt?: never;
  href?: never;
  snapshot?: never;
}

export interface ProjectCitation extends z.infer<typeof projectCitationSchema> {
  chunkId?: never;
  documentId?: never;
  filename?: never;
  pageNumber?: never;
  sectionTitle?: never;
  score?: never;
  matchType?: never;
}

/** Discriminated union keeps existing document fields safe after narrowing. */
export type Citation = DocumentCitation | ProjectCitation;

// --- API inputs ------------------------------------------------------------

export const askQuestionSchema = z.object({
  question: z.string().trim().min(3, "Question is too short").max(2000),
  conversationId: z.string().optional(),
  projectId: z.string().min(1).nullable().optional(),
});

export const renameConversationSchema = z.object({
  title: z.string().trim().min(1, "Give the thread a name").max(120),
});

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Project name is required").max(120),
  description: z.string().trim().max(1000).optional(),
});

export const updateProjectSchema = createProjectSchema.partial().refine(
  (value) => value.name !== undefined || value.description !== undefined,
  "Provide a name or description",
);

export const assignDocumentProjectSchema = z.object({
  projectId: z.string().min(1).nullable(),
});

// --- Project management ----------------------------------------------------

export const taskStatusCategorySchema = z.enum(["open", "blocked", "done"]);
export const taskStatusColorSchema = z.enum([
  "slate",
  "blue",
  "amber",
  "red",
  "emerald",
  "violet",
  "pink",
  "cyan",
]);
export const taskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export const milestoneStatusSchema = z.enum([
  "not_started",
  "on_track",
  "at_risk",
  "blocked",
  "completed",
]);
export const riskLevelSchema = z.enum(["low", "medium", "high"]);
export const riskStatusSchema = z.enum([
  "open",
  "monitoring",
  "mitigated",
  "accepted",
]);

/**
 * `<input type="date">` submits `YYYY-MM-DD`, which coerces to UTC midnight —
 * the same granularity src/lib/pm/rules.ts compares at. An empty string means
 * "clear the date", so it maps to null rather than an Invalid Date.
 */
const optionalDate = z
  .union([z.literal(""), z.coerce.date()])
  .nullable()
  .optional()
  .transform((value) => (value === "" ? null : value));

/**
 * An omitted key stays `undefined` ("leave it alone"); an empty string or an
 * explicit null becomes null ("clear it"). Collapsing the two would make every
 * PATCH erase the text fields it did not mention.
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? undefined : value || null));

/**
 * Rejects `{}` so a PATCH always states what it is changing.
 *
 * This only holds because the update schemas carry no defaults — `.partial()`
 * does not strip `.default()`, so a defaulted field would materialise on an
 * empty body and make every update look intentional.
 */
const requiresOneField = (value: object) =>
  Object.values(value).some((field) => field !== undefined);

const taskFields = {
  title: z.string().trim().min(1, "Task title is required").max(200),
  description: optionalText(4000),
  /** ProjectTaskStatus id — resolved against the project on every write. */
  statusId: z.string().min(1),
  priority: taskPrioritySchema,
  assigneeId: z.string().min(1).nullable().optional(),
  milestoneId: z.string().min(1).nullable().optional(),
  estimatedHours: z.coerce
    .number()
    .min(0, "Estimate cannot be negative")
    .max(10_000)
    .nullable()
    .optional(),
  startDate: optionalDate,
  dueDate: optionalDate,
};

/** A bar cannot end before it begins; checked on both create and update. */
function startBeforeDue(value: {
  startDate?: Date | null;
  dueDate?: Date | null;
}) {
  if (!value.startDate || !value.dueDate) return true;
  return value.startDate.getTime() <= value.dueDate.getTime();
}

const DATE_ORDER_MESSAGE = "Start date must be on or before the due date";

export const createTaskSchema = z
  .object({
    ...taskFields,
    // Omitted → the project's default column (usually Backlog).
    statusId: taskFields.statusId.optional(),
    priority: taskFields.priority.default("medium"),
  })
  .refine(startBeforeDue, {
    message: DATE_ORDER_MESSAGE,
    path: ["startDate"],
  });

export const updateTaskSchema = z
  .object(taskFields)
  .partial()
  .refine(requiresOneField, "Provide at least one field to update")
  // Only checks the pair when both arrive together; a PATCH that moves one date
  // past the other is validated against the stored row in the route handler.
  .refine(startBeforeDue, { message: DATE_ORDER_MESSAGE, path: ["startDate"] });

export const createTaskStatusSchema = z.object({
  label: z.string().trim().min(1, "Status name is required").max(40),
  category: taskStatusCategorySchema.default("open"),
  color: taskStatusColorSchema.optional(),
});

export const updateTaskStatusSchema = z
  .object({
    label: z.string().trim().min(1, "Status name is required").max(40),
    category: taskStatusCategorySchema,
    color: taskStatusColorSchema.nullable(),
    isDefault: z.boolean(),
  })
  .partial()
  .refine(requiresOneField, "Provide at least one field to update");

export const createTaskDependencySchema = z.object({
  dependsOnTaskId: z.string().min(1, "Select a task"),
});

export const createTaskCommentSchema = z.object({
  // Trimmed before the length check so a comment of only whitespace is rejected
  // rather than stored as an empty row.
  body: z.string().trim().min(1, "Write a comment first").max(4000),
});

const milestoneFields = {
  title: z.string().trim().min(1, "Milestone title is required").max(200),
  description: optionalText(4000),
  targetDate: optionalDate,
  status: milestoneStatusSchema,
};

export const createMilestoneSchema = z.object({
  ...milestoneFields,
  status: milestoneFields.status.default("not_started"),
});

export const updateMilestoneSchema = z
  .object(milestoneFields)
  .partial()
  .refine(requiresOneField, "Provide at least one field to update");

const riskFields = {
  description: z.string().trim().min(1, "Risk description is required").max(4000),
  milestoneId: z.string().min(1).nullable().optional(),
  impact: riskLevelSchema,
  likelihood: riskLevelSchema,
  mitigation: optionalText(4000),
  status: riskStatusSchema,
};

export const createRiskSchema = z.object({
  ...riskFields,
  impact: riskFields.impact.default("medium"),
  likelihood: riskFields.likelihood.default("medium"),
  status: riskFields.status.default("open"),
});

export const updateRiskSchema = z
  .object(riskFields)
  .partial()
  .refine(requiresOneField, "Provide at least one field to update");

// --- Requirements ----------------------------------------------------------

export const requirementTypeSchema = z.enum([
  "business",
  "functional",
  "non_functional",
  "constraint",
]);
export const requirementPrioritySchema = z.enum([
  "must",
  "should",
  "could",
  "wont",
]);
export const requirementStatusSchema = z.enum([
  "draft",
  "needs_clarification",
  "validated",
  "approved",
  "rejected",
]);
export const requirementConfidenceSchema = z.enum(["high", "medium", "low"]);
export const requirementLinkTargetSchema = z.enum([
  "task",
  "milestone",
  "risk",
]);

const requirementFields = {
  title: z.string().trim().min(1, "Requirement title is required").max(200),
  description: optionalText(4000),
  type: requirementTypeSchema,
  priority: requirementPrioritySchema,
  status: requirementStatusSchema,
  acceptanceCriteria: optionalText(4000),
  assumptions: optionalText(4000),
  confidence: requirementConfidenceSchema,
  stakeholder: optionalText(200),
};

export const createRequirementSchema = z.object({
  ...requirementFields,
  type: requirementFields.type.default("functional"),
  priority: requirementFields.priority.default("should"),
  // Writing a requirement down is not agreeing it, so a manual record starts as
  // a draft exactly like an extracted one.
  status: requirementFields.status.default("draft"),
  confidence: requirementFields.confidence.default("medium"),
});

export const updateRequirementSchema = z
  .object(requirementFields)
  .partial()
  .refine(requiresOneField, "Provide at least one field to update");

export const createRequirementLinkSchema = z.object({
  targetType: requirementLinkTargetSchema,
  targetId: z.string().min(1, "Select a record to link"),
});

export const feedbackSchema = z.object({
  chatMessageId: z.string().min(1),
  rating: z.enum(["up", "down"]),
  comment: z.string().max(2000).optional(),
});

export const createEvaluationSchema = z.object({
  question: z.string().trim().min(3).max(2000),
  expectedAnswerNotes: z.string().max(4000).optional(),
  /** Golden-set expectation: the answer must mention all of these. */
  expectedKeywords: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  /** Golden-set expectation: this question is not answerable from the corpus. */
  shouldRefuse: z.boolean().default(false),
  projectId: z.string().min(1).nullable().optional(),
});

/** Re-runs stored cases against the live pipeline as a regression check. */
export const runEvaluationsSchema = z.object({
  action: z.literal("run-all"),
});

export const reviewEvaluationSchema = z.object({
  id: z.string().min(1),
  result: z.enum(["pass", "fail", "unreviewed"]),
});

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});
