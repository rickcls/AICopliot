import { describe, expect, it } from "vitest";
import { assistantSystemPrompt } from "@/lib/assistant/protocol";
import {
  buildReviseBlock,
  CAPTURE_SYSTEM_PROMPT,
  clarificationLine,
  stripClarificationMarker,
  TASK_TITLE_STYLE,
} from "@/lib/capture/prompt";

/**
 * The capture prompt's text and the block that asks for one suggestion to be
 * redone. The model is not trusted to follow either — the validator is the
 * gate — but a rule missing from the prompt is a failure made common.
 */

describe("capture prompt", () => {
  it("changes an existing task only when the line is clearly about it", () => {
    expect(CAPTURE_SYSTEM_PROMPT).toContain("Sharing a word is not enough");
    expect(CAPTURE_SYSTEM_PROMPT).toContain("When unsure, create a new task");
  });

  it("asks for a description drawn from the cited lines", () => {
    expect(CAPTURE_SYSTEM_PROMPT).toContain("adding nothing the lines do not say");
    expect(CAPTURE_SYSTEM_PROMPT).not.toContain('"description":null');
  });

  it("names tasks in clean written Chinese or plain English, in capture and the assistant alike", () => {
    expect(TASK_TITLE_STYLE).toContain("standard written Chinese (書面語), never Cantonese colloquial");
    expect(TASK_TITLE_STYLE).toContain("Keep names, numbers, amounts, codes");
    expect(CAPTURE_SYSTEM_PROMPT).toContain(TASK_TITLE_STYLE);
    expect(assistantSystemPrompt(false)).toContain(TASK_TITLE_STYLE);
  });

  it("lets a later correction win over the lines it corrects", () => {
    expect(CAPTURE_SYSTEM_PROMPT).toContain('"補充："');
    expect(CAPTURE_SYSTEM_PROMPT).toContain("the correction wins");
  });
});

describe("clarificationLine", () => {
  it("marks a correction and keeps it on one line", () => {
    expect(clarificationLine("季度報告\n係新工作", "zh-Hant")).toBe("補充：季度報告 係新工作");
    expect(clarificationLine("  It is new  ", "en")).toBe("Clarification: It is new");
  });

  it("can take the marker off again", () => {
    expect(stripClarificationMarker("補充：季度報告係新工作")).toBe("季度報告係新工作");
    expect(stripClarificationMarker("Clarification: It is new")).toBe("It is new");
    expect(stripClarificationMarker("月報已經交咗")).toBe("月報已經交咗");
  });
});

describe("buildReviseBlock", () => {
  it("names the suggestion being redone by its labels", () => {
    const block = buildReviseBlock(
      { kind: "update_task", summary: "status done", taskLabel: "T3", taskTitle: "提交月報", citedLabels: ["C2"] },
      ["C4"],
    );
    expect(block).toContain('update T3 ("提交月報"): status done, citing C2');
    expect(block).toContain("Their correction is C4");
    expect(block).toContain("at most 3");
  });

  it("lists the other suggestions so the replacement does not repeat them", () => {
    const block = buildReviseBlock(
      { kind: "create_task", summary: "跟進月報", taskLabel: null, taskTitle: null, citedLabels: ["C1"] },
      ["C3"],
      ['new task "交季度報告"'],
    );
    expect(block).toContain('Other suggestions on the list, which stay as they are: new task "交季度報告"');
    expect(block).toContain("not the correction");
  });

  it("names a task that is no longer a candidate by its title alone", () => {
    const block = buildReviseBlock(
      { kind: "add_note", summary: "已交", taskLabel: null, taskTitle: "提交月報", citedLabels: ["C1"] },
      ["C3", "C4"],
    );
    expect(block).toContain('the task "提交月報", which is not in TASKS');
    expect(block).toContain("Their correction is C3, C4");
  });
});
