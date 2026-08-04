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

/** Citation as rendered to the user, resolved back to real records. */
export const citationSchema = z.object({
  chunkId: z.string(),
  documentId: z.string(),
  filename: z.string(),
  pageNumber: z.number().int().nullable(),
  sectionTitle: z.string().nullable(),
  excerpt: z.string(),
  score: z.number(),
  matchType: z.enum(["semantic", "lexical", "hybrid"]).optional(),
});
export type Citation = z.infer<typeof citationSchema>;

// --- API inputs ------------------------------------------------------------

export const askQuestionSchema = z.object({
  question: z.string().trim().min(3, "Question is too short").max(2000),
  conversationId: z.string().optional(),
  projectId: z.string().min(1).nullable().optional(),
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

export const taskStatusSchema = z.enum([
  "backlog",
  "todo",
  "in_progress",
  "blocked",
  "done",
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
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  assigneeId: z.string().min(1).nullable().optional(),
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
    status: taskFields.status.default("backlog"),
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

export const createTaskDependencySchema = z.object({
  dependsOnTaskId: z.string().min(1, "Select a task"),
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
