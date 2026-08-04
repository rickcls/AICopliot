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
});
export type Citation = z.infer<typeof citationSchema>;

// --- API inputs ------------------------------------------------------------

export const askQuestionSchema = z.object({
  question: z.string().trim().min(3, "Question is too short").max(2000),
  conversationId: z.string().optional(),
});

export const feedbackSchema = z.object({
  chatMessageId: z.string().min(1),
  rating: z.enum(["up", "down"]),
  comment: z.string().max(2000).optional(),
});

export const createEvaluationSchema = z.object({
  question: z.string().trim().min(3).max(2000),
  expectedAnswerNotes: z.string().max(4000).optional(),
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
