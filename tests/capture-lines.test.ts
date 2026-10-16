import { describe, expect, it } from "vitest";
import {
  buildCaptureBlock,
  citedNeighbourhood,
  splitCaptureLines,
} from "@/lib/capture/lines";

describe("splitCaptureLines", () => {
  it("labels one line per newline and per sentence", () => {
    const { lines } = splitCaptureLines(
      "聽日要send報價俾ABC公司。月報已經交咗！\nWaiting for Peter. Then call Mary",
    );
    expect(lines).toEqual([
      { label: "C1", text: "聽日要send報價俾ABC公司。" },
      { label: "C2", text: "月報已經交咗！" },
      { label: "C3", text: "Waiting for Peter." },
      { label: "C4", text: "Then call Mary" },
    ]);
  });

  it("drops blank lines and collapses spaces", () => {
    expect(splitCaptureLines("  a   b  \n\n\n  c ").lines.map((line) => line.text)).toEqual([
      "a b",
      "c",
    ]);
  });

  it("does not split decimals or times", () => {
    expect(splitCaptureLines("Budget is 3.5 hours at 10.30am").lines).toHaveLength(1);
  });

  it("hard-splits a long unpunctuated dictation run", () => {
    const run = "聽日要做報告".repeat(80);
    const { lines } = splitCaptureLines(run, { maxLineChars: 100 });
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => line.text.length <= 100)).toBe(true);
    expect(lines.map((line) => line.text).join("")).toBe(run);
  });

  it("stops at the line limit and says so", () => {
    const text = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n");
    const { lines, truncated } = splitCaptureLines(text, { maxLines: 4 });
    expect(lines).toHaveLength(4);
    expect(truncated).toBe(true);
  });
});

describe("prompt block and neighbourhood", () => {
  const { lines } = splitCaptureLines("one\ntwo\nthree\nfour");

  it("renders each line with its label", () => {
    expect(buildCaptureBlock(lines)).toBe("[C1] one\n[C2] two\n[C3] three\n[C4] four");
  });

  it("joins the cited lines with their neighbours, in order, once each", () => {
    expect(citedNeighbourhood(lines, ["C3", "C2"])).toBe("onetwothreefour");
    expect(citedNeighbourhood(lines, ["C1"])).toBe("onetwo");
    expect(citedNeighbourhood(lines, ["C9"])).toBe("");
  });
});
