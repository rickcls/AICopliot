import { describe, expect, it } from "vitest";
import { splitLabelRefs } from "@/lib/chat/citation-labels";
import { parseAnswer } from "@/lib/chat/markdown";

/**
 * The renderer only has to handle what modelAnswerSchema.answer actually
 * contains, and it has to recognise the two headings PROJECT_SYSTEM_PROMPT
 * mandates — which are bare text, so no general markdown parser would.
 */

describe("parseAnswer — blocks", () => {
  it("treats each mandated heading on its own line as a heading", () => {
    const blocks = parseAnswer(
      "Document requirements\nThe SOP requires two approvers.\n\nCurrent project state\nTwo tasks are open.",
    );

    expect(blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "paragraph",
    ]);
    expect(blocks[0]).toEqual({ type: "heading", text: "Document requirements" });
  });

  it("leaves the same words alone inside a sentence", () => {
    const blocks = parseAnswer("The document requirements were agreed in March.");

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");
  });

  it("accepts a mandated heading emphasised or followed by a colon", () => {
    expect(parseAnswer("**Current project state:**")[0]).toEqual({
      type: "heading",
      text: "Current project state",
    });
  });

  it("reads an ATX heading", () => {
    expect(parseAnswer("## Escalation")[0]).toEqual({
      type: "heading",
      text: "Escalation",
    });
  });

  it("groups consecutive bullets into one list", () => {
    const blocks = parseAnswer("- First step\n- Second step\n- Third step");

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "list", ordered: false });
    expect(blocks[0].type === "list" && blocks[0].items).toHaveLength(3);
  });

  it("marks a numbered list as ordered", () => {
    const blocks = parseAnswer("1. Page the on-call\n2. Open an incident");

    expect(blocks[0]).toMatchObject({ type: "list", ordered: true });
  });

  it("joins a soft-wrapped paragraph but keeps blank-line breaks", () => {
    const blocks = parseAnswer("One sentence\nwrapped over lines.\n\nA second paragraph.");

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      type: "paragraph",
      inlines: [{ type: "text", value: "One sentence wrapped over lines." }],
    });
  });

  it("keeps a fenced block verbatim, blank lines and all", () => {
    const blocks = parseAnswer("Run this:\n\n```\nsystemctl restart db\n\nsystemctl status db\n```");

    expect(blocks[1]).toEqual({
      type: "code",
      value: "systemctl restart db\n\nsystemctl status db",
    });
  });

  it("produces no block type that could carry raw markup", () => {
    const types = new Set(
      parseAnswer("# H\n\ntext\n\n- item\n\n```\ncode\n```").map((b) => b.type),
    );

    expect([...types].sort()).toEqual(["code", "heading", "list", "paragraph"]);
  });
});

describe("parseAnswer — inlines", () => {
  it("preserves a backticked path exactly", () => {
    const blocks = parseAnswer("Check `/etc/postgresql/17/main/pg_hba.conf` first.");

    expect(blocks[0]).toEqual({
      type: "paragraph",
      inlines: [
        { type: "text", value: "Check " },
        { type: "code", value: "/etc/postgresql/17/main/pg_hba.conf" },
        { type: "text", value: " first." },
      ],
    });
  });

  it("reads bold as its own inline", () => {
    const blocks = parseAnswer("This is **important** context.");

    expect(blocks[0].type === "paragraph" && blocks[0].inlines[1]).toEqual({
      type: "strong",
      value: "important",
    });
  });

  it("turns a known label inside a list item into a citation", () => {
    const blocks = parseAnswer("- Restart the service [S1]", ["S1"]);

    expect(blocks[0].type === "list" && blocks[0].items[0]).toEqual([
      { type: "text", value: "Restart the service " },
      { type: "citation", label: "S1" },
    ]);
  });
});

describe("splitLabelRefs", () => {
  const known = new Set(["S1", "T2", "Q1"]);

  it("converts a known bracketed label", () => {
    expect(splitLabelRefs("Two approvers are required [S1].", known)).toEqual([
      { type: "text", value: "Two approvers are required " },
      { type: "citation", label: "S1" },
      { type: "text", value: "." },
    ]);
  });

  it("converts the parenthesised form too", () => {
    expect(splitLabelRefs("The task is blocked (T2).", known)).toEqual([
      { type: "text", value: "The task is blocked " },
      { type: "citation", label: "T2" },
      { type: "text", value: "." },
    ]);
  });

  it("splits a comma group into one chip per label", () => {
    expect(splitLabelRefs("Both agree [S1, T2].", known)).toEqual([
      { type: "text", value: "Both agree " },
      { type: "citation", label: "S1" },
      { type: "citation", label: "T2" },
      { type: "text", value: "." },
    ]);
  });

  it("leaves a label the answer did not keep as literal text", () => {
    // S9 was dropped by citation validation, so there is no card to jump to.
    expect(splitLabelRefs("Claimed in [S9].", known)).toEqual([
      { type: "text", value: "Claimed in [S9]." },
    ]);
  });

  it("leaves a whole group literal when any member was dropped", () => {
    // Rendering only [S1] would silently hide that the model also cited S9.
    expect(splitLabelRefs("Both [S1, S9].", known)).toEqual([
      { type: "text", value: "Both [S1, S9]." },
    ]);
  });

  it("leaves everything literal when no labels are known at all", () => {
    // The path a thread persisted before citations carried labels takes.
    expect(splitLabelRefs("Two approvers [S1].", new Set())).toEqual([
      { type: "text", value: "Two approvers [S1]." },
    ]);
  });

  it("does not mistake ordinary bracketed text for a label", () => {
    expect(splitLabelRefs("Applies in the region (EU) and to [1].", known)).toEqual([
      { type: "text", value: "Applies in the region (EU) and to [1]." },
    ]);
  });
});
