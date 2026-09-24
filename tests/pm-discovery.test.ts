import { describe, expect, it } from "vitest";
import { nextDiscoveryStep, type DiscoveryCounts } from "@/lib/pm/discovery";
import { requirementStatusLabel } from "@/lib/pm/labels";

const EMPTY: DiscoveryCounts = {
  documents: 0,
  readyDocuments: 0,
  toReview: 0,
  askClient: 0,
  validated: 0,
  agreed: 0,
  rejected: 0,
};

function step(overrides: Partial<DiscoveryCounts>) {
  return nextDiscoveryStep({ ...EMPTY, ...overrides });
}

describe("nextDiscoveryStep", () => {
  it("starts by asking for a document", () => {
    expect(step({})).toBe("upload");
  });

  it("waits while nothing is indexed yet", () => {
    expect(step({ documents: 2 })).toBe("wait_indexing");
  });

  it("asks for an extraction once a document is ready", () => {
    expect(step({ documents: 2, readyDocuments: 1 })).toBe("extract");
  });

  it("treats a register of only rejected rows as nothing extracted", () => {
    expect(step({ documents: 1, readyDocuments: 1, rejected: 5 })).toBe("extract");
  });

  it("puts unread drafts ahead of client questions", () => {
    expect(
      step({ documents: 1, readyDocuments: 1, toReview: 3, askClient: 2 }),
    ).toBe("review");
  });

  it("moves to client questions once drafts are reviewed", () => {
    expect(
      step({ documents: 1, readyDocuments: 1, askClient: 2, validated: 4 }),
    ).toBe("clarify");
  });

  it("asks for agreement when only validated rows remain undecided", () => {
    expect(step({ documents: 1, readyDocuments: 1, validated: 4, agreed: 1 })).toBe(
      "agree",
    );
  });

  it("offers sign-off once everything live is agreed", () => {
    expect(step({ documents: 1, readyDocuments: 1, agreed: 6, rejected: 2 })).toBe(
      "sign_off",
    );
  });
});

describe("requirementStatusLabel", () => {
  it("names statuses for the job, not the model", () => {
    expect(requirementStatusLabel("needs_clarification")).toBe("Ask client");
    expect(requirementStatusLabel("approved")).toBe("Agreed");
    expect(requirementStatusLabel("draft")).toBe("To review");
  });

  it("falls back to readable words for an unknown value", () => {
    expect(requirementStatusLabel("on_hold")).toBe("on hold");
  });
});
