import { describe, expect, it } from "vitest";
import {
  askQuestionSchema,
  assignDocumentProjectSchema,
  createProjectSchema,
} from "@/lib/schemas";

describe("project inputs", () => {
  it("trims valid project names", () => {
    const result = createProjectSchema.parse({
      name: "  Network Refresh  ",
      description: "  Production rollout  ",
    });

    expect(result).toEqual({
      name: "Network Refresh",
      description: "Production rollout",
    });
  });

  it("rejects blank project names", () => {
    expect(createProjectSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("allows a document to be assigned or explicitly unassigned", () => {
    expect(assignDocumentProjectSchema.parse({ projectId: "project-1" })).toEqual({
      projectId: "project-1",
    });
    expect(assignDocumentProjectSchema.parse({ projectId: null })).toEqual({
      projectId: null,
    });
  });

  it("accepts an explicit project scope for a question", () => {
    expect(
      askQuestionSchema.parse({ question: "How do I restart it?", projectId: "p1" }),
    ).toMatchObject({ projectId: "p1" });
  });
});
