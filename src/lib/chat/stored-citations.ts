import { z } from "zod";
import { citationSchema, type Citation } from "@/lib/schemas";

/**
 * `ChatMessage.citations` is an untyped `Json?` column, so replaying a thread
 * means re-validating audit data that may have been written against an older
 * shape of the schema.
 *
 * A blob that no longer parses is dropped rather than thrown, because one stale
 * row must not 500 a whole conversation — but the caller is told, because
 * invariant 3 treats an uncited claim as the shape a hallucination takes. A
 * historic answer that was properly cited when produced is not a hallucination,
 * yet it must not be *rendered* as an uncited assertion either.
 */

const storedCitationsSchema = z.array(citationSchema);

export interface StoredCitations {
  citations: Citation[];
  /** True when a stored blob existed but could not be validated. */
  unavailable: boolean;
}

export function parseStoredCitations(value: unknown): StoredCitations {
  if (value == null) return { citations: [], unavailable: false };

  const parsed = storedCitationsSchema.safeParse(value);
  if (!parsed.success) return { citations: [], unavailable: true };

  return { citations: parsed.data, unavailable: false };
}
