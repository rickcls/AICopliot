import { describe, expect, it } from "vitest";
import { validateDependency } from "@/lib/pm/rules";

/**
 * Task dependency rules.
 *
 * Pure, so the three failure modes are pinned without a database. A
 * self-reference is additionally blocked by a CHECK constraint and a duplicate
 * by a unique index, so a mistake here degrades to a database error rather than
 * corrupt data — these assertions are about returning the right status to the
 * user, not about being the only guard.
 */

const base = {
  taskId: "task-1",
  dependsOnTaskId: "task-2",
  sameProject: true,
  existingDependsOnIds: [] as string[],
};

describe("validateDependency", () => {
  it("accepts a distinct task in the same project", () => {
    expect(validateDependency(base)).toEqual({ ok: true });
  });

  it("rejects a task depending on itself", () => {
    const result = validateDependency({ ...base, dependsOnTaskId: "task-1" });

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(result.ok === false && result.error).toMatch(/itself/i);
  });

  it("rejects self-reference before anything else, even when other checks would also fail", () => {
    // A self-reference is invalid regardless of project or duplicate state.
    const result = validateDependency({
      taskId: "task-1",
      dependsOnTaskId: "task-1",
      sameProject: false,
      existingDependsOnIds: ["task-1"],
    });

    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects a duplicate dependency", () => {
    const result = validateDependency({
      ...base,
      existingDependsOnIds: ["task-2"],
    });

    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(result.ok === false && result.error).toMatch(/already exists/i);
  });

  it("allows a second, different dependency on the same task", () => {
    expect(
      validateDependency({
        ...base,
        dependsOnTaskId: "task-3",
        existingDependsOnIds: ["task-2"],
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a task that did not resolve in the same project", () => {
    // sameProject is false both when the target belongs to another project and
    // when it did not resolve at all under the workspace-scoped lookup, so an
    // ID from another workspace lands here too.
    const result = validateDependency({ ...base, sameProject: false });

    expect(result).toMatchObject({ ok: false, status: 404 });
  });
});
