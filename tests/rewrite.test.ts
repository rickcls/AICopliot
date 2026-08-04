import { describe, expect, it, vi } from "vitest";
import { needsRewrite, rewriteQuestion, type ChatTurn } from "@/lib/rag/rewrite";

/**
 * Follow-up rewriting. The load-bearing property is that the REWRITTEN text is
 * what gets embedded — rewriting only the answering prompt would leave
 * retrieval searching for "what about for Sev-2", which matches nothing.
 */

type Messages = Array<{ role: string; content: string }>;

function chatReturning(text: string) {
  return {
    modelName: "fake",
    // Parameter is declared so mock.calls is typed for the prompt assertions.
    complete: vi.fn(async (_messages: Messages) => text),
  };
}

const history: ChatTurn[] = [
  { role: "user", content: "How do I promote the standby database?" },
  { role: "assistant", content: "Run `repmgr standby promote`." },
];

describe("needsRewrite", () => {
  it("is false for the first question in a thread", () => {
    expect(needsRewrite([])).toBe(false);
  });

  it("is true once there is history", () => {
    expect(needsRewrite(history)).toBe(true);
  });
});

describe("rewriteQuestion", () => {
  it("does not call the model when there is no history", async () => {
    const chat = chatReturning("unused");

    const result = await rewriteQuestion("How do I promote the standby?", [], chat);

    // Saves a round trip on every first question in a conversation.
    expect(chat.complete).not.toHaveBeenCalled();
    expect(result).toBe("How do I promote the standby?");
  });

  it("resolves a context-dependent follow-up into a standalone question", async () => {
    const chat = chatReturning(
      "How do I promote the standby database for a Sev-2 incident?",
    );

    const result = await rewriteQuestion("what about for Sev-2?", history, chat);

    expect(chat.complete).toHaveBeenCalledTimes(1);
    expect(result).toBe(
      "How do I promote the standby database for a Sev-2 incident?",
    );
  });

  it("includes the prior turns in the rewrite prompt", async () => {
    const chat = chatReturning("standalone question");

    await rewriteQuestion("what about for Sev-2?", history, chat);

    const prompt = chat.complete.mock.calls[0][0].at(-1)?.content ?? "";
    expect(prompt).toContain("How do I promote the standby database?");
    expect(prompt).toContain("repmgr standby promote");
    expect(prompt).toContain("what about for Sev-2?");
  });

  it("strips surrounding quotes the model may add", async () => {
    const chat = chatReturning('"How do I promote the standby for Sev-2?"');

    const result = await rewriteQuestion("what about Sev-2?", history, chat);

    expect(result).toBe("How do I promote the standby for Sev-2?");
  });

  it("falls back to the original question when the model errors", async () => {
    const chat = {
      modelName: "fake",
      complete: vi.fn(async () => {
        throw new Error("provider down");
      }),
    };

    const result = await rewriteQuestion("what about Sev-2?", history, chat);

    // A rewrite failure must degrade to the literal question, never block.
    expect(result).toBe("what about Sev-2?");
  });

  it("falls back when the model answers instead of rewriting", async () => {
    const chat = chatReturning(
      "To promote the standby you should first confirm the primary is down, then run repmgr standby promote, and afterwards verify replication has caught up before routing traffic. You will also want to notify the on-call channel and file a postmortem within five business days as required by policy.",
    );

    const result = await rewriteQuestion("what about Sev-2?", history, chat);

    expect(result).toBe("what about Sev-2?");
  });

  it("returns an already-standalone question unchanged", async () => {
    const chat = chatReturning("What is the escalation path for a Sev-1?");

    const result = await rewriteQuestion(
      "What is the escalation path for a Sev-1?",
      history,
      chat,
    );

    expect(result).toBe("What is the escalation path for a Sev-1?");
  });
});
