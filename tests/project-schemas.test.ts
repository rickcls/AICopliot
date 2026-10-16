import { describe, expect, it } from "vitest";
import {
  askQuestionSchema,
  assignDocumentProjectSchema,
  createProjectSchema,
  updatePreferencesSchema,
  updateProjectSchema,
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

describe("delivery tools setting", () => {
  it("accepts deliveryEnabled on its own", () => {
    expect(updateProjectSchema.safeParse({ deliveryEnabled: true }).success).toBe(
      true,
    );
  });

  it("rejects a non-boolean value", () => {
    expect(
      updateProjectSchema.safeParse({ deliveryEnabled: "yes" }).success,
    ).toBe(false);
  });

  it("still rejects an empty update", () => {
    expect(updateProjectSchema.safeParse({}).success).toBe(false);
  });
});

describe("requirements discovery setting", () => {
  it("accepts discoveryEnabled on its own", () => {
    expect(updateProjectSchema.safeParse({ discoveryEnabled: false }).success).toBe(
      true,
    );
  });

  it("rejects a non-boolean value", () => {
    expect(
      updateProjectSchema.safeParse({ discoveryEnabled: 1 }).success,
    ).toBe(false);
  });
});

describe("personal preferences", () => {
  it("accepts a supported language or a real time zone", () => {
    expect(updatePreferencesSchema.safeParse({ locale: "en" }).success).toBe(true);
    expect(
      updatePreferencesSchema.safeParse({ timeZone: "Asia/Hong_Kong" }).success,
    ).toBe(true);
  });

  it("rejects an unsupported language, an unknown zone, or nothing at all", () => {
    expect(updatePreferencesSchema.safeParse({ locale: "zh-Hans" }).success).toBe(false);
    expect(updatePreferencesSchema.safeParse({ timeZone: "Mars/Olympus" }).success).toBe(
      false,
    );
    expect(updatePreferencesSchema.safeParse({}).success).toBe(false);
  });

  it("never fills in the field a PATCH left out", () => {
    expect(updatePreferencesSchema.parse({ locale: "en" })).toEqual({ locale: "en" });
  });
});

