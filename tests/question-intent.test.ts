import { describe, expect, it } from "vitest";
import { asksAboutRecordsOnly, readQuestionIntent } from "@/lib/rag/intent";

/**
 * Which records a project question reaches is decided from its words, not by
 * the model — so the same question always gets the same evidence.
 */

describe("readQuestionIntent", () => {
  it("reads open work in English and Chinese", () => {
    expect(readQuestionIntent("What tasks are still pending?").openWork).toBe(true);
    expect(readQuestionIntent("有什麼 pending task").openWork).toBe(true);
    expect(readQuestionIntent("仲有咩未完成？").openWork).toBe(true);
    expect(readQuestionIntent("Who owns the quote?").openWork).toBe(false);
  });

  it("reads a progress question", () => {
    expect(readQuestionIntent("報價進度點？").progress).toBe(true);
    expect(readQuestionIntent("How is the migration going so far?").progress).toBe(true);
    expect(readQuestionIntent("When is the quote due?").progress).toBe(false);
  });

  it("notices when the question names the files", () => {
    expect(readQuestionIntent("根據文件，有什麼未完成？").documents).toBe(true);
    expect(readQuestionIntent("What does the contract require?").documents).toBe(true);
  });
});

describe("asksAboutRecordsOnly", () => {
  it("is about the work itself unless the files are named", () => {
    expect(asksAboutRecordsOnly(readQuestionIntent("有什麼 pending task"))).toBe(true);
    expect(asksAboutRecordsOnly(readQuestionIntent("報價進度點？"))).toBe(true);
    expect(asksAboutRecordsOnly(readQuestionIntent("根據合約，報價進度點？"))).toBe(false);
    expect(asksAboutRecordsOnly(readQuestionIntent("What does the brief say about SSO?"))).toBe(false);
  });
});
