import { z } from "zod";

/**
 * The capture model's JSON contract.
 *
 * Proposals are parsed one at a time (`modelProposalSchema.safeParse` per
 * item), and optional fields `.catch(null)`, so one malformed proposal — or
 * one bad date inside a good one — costs only itself.
 */

const labels = z.array(z.string().trim().min(1).max(12)).max(12).catch([]);
const priority = z.enum(["low", "medium", "high", "urgent"]).nullable().catch(null);
const due = z
  .object({
    phrase: z.string().trim().min(1).max(80),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .nullable()
  .catch(null);

export const modelProposalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create_task"),
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(2000).nullable().catch(null),
    project: z.string().trim().max(12).nullable().catch(null),
    priority,
    // A new task is blocked or ordinary. "done" and "open" are not a starting state.
    status: z.enum(["blocked"]).nullable().catch(null),
    due,
    estimatedHours: z.number().positive().max(1000).nullable().catch(null),
    citations: labels,
  }),
  z.object({
    kind: z.literal("update_task"),
    task: z.string().trim().min(1).max(12),
    status: z.enum(["done", "blocked", "open"]).nullable().catch(null),
    priority,
    due,
    citations: labels,
  }),
  z.object({
    kind: z.literal("add_note"),
    task: z.string().trim().min(1).max(12),
    note: z.string().trim().min(1).max(2000),
    citations: labels,
  }),
]);
export type ModelProposal = z.infer<typeof modelProposalSchema>;

export const modelCaptureSchema = z.object({
  proposals: z.array(z.unknown()).max(60),
});

/** What Apply may change before writing — the person's edits to a proposal. */
export const proposalOverridesSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000).nullable(),
    projectId: z.string().trim().min(1),
    priority: z.enum(["low", "medium", "high", "urgent"]).nullable(),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    status: z.enum(["done", "blocked", "open"]).nullable(),
    note: z.string().trim().min(1).max(4000),
    /** A new task's assignee; the person applying when absent. Membership is checked on write. */
    assigneeId: z.string().trim().min(1),
  })
  .partial();
export type ProposalOverrides = z.infer<typeof proposalOverridesSchema>;

/** What the person says is wrong with one suggestion, for the model to redo it. */
export const reviseProposalSchema = z.object({
  instruction: z.string().trim().min(2, "Say what is wrong first").max(500),
});

export const createCaptureSchema = z.object({
  text: z.string().trim().min(3, "Write a little more first").max(8000).optional(),
  documentId: z.string().trim().min(1).optional(),
  source: z.enum(["text", "voice"]).default("text"),
}).refine(
  (value) => (value.text === undefined) !== (value.documentId === undefined),
  "Send text or a document, not both",
);

export const applyCaptureSchema = z.object({
  items: z
    .array(
      z.object({
        proposalId: z.string().trim().min(1),
        overrides: proposalOverridesSchema.optional(),
      }),
    )
    .min(1)
    .max(20),
});

export const decideProposalSchema = z.object({
  state: z.enum(["dismissed", "pending"]),
});
