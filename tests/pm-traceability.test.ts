import { describe, expect, it } from "vitest";
import {
  countDeliveryStates,
  deliveryState,
  type TracedLink,
} from "@/lib/pm/traceability";

function taskLink(category: string): TracedLink {
  return { targetType: "task", task: { status: { category } } };
}

const milestoneLink: TracedLink = { targetType: "milestone", task: null };
const riskLink: TracedLink = { targetType: "risk", task: null };

describe("deliveryState", () => {
  it("is no_task when nothing delivers the requirement", () => {
    expect(deliveryState([])).toBe("no_task");
  });

  it("does not let a milestone or risk link count as delivery", () => {
    expect(deliveryState([milestoneLink, riskLink])).toBe("no_task");
  });

  it("is planned while no linked task is done, including blocked ones", () => {
    expect(deliveryState([taskLink("open"), taskLink("blocked")])).toBe("planned");
  });

  it("is partial when some but not all linked tasks are done", () => {
    expect(deliveryState([taskLink("done"), taskLink("open")])).toBe("partial");
  });

  it("is delivered only when every linked task is done", () => {
    expect(deliveryState([taskLink("done"), taskLink("done"), milestoneLink])).toBe(
      "delivered",
    );
  });
});

describe("countDeliveryStates", () => {
  it("counts each row exactly once", () => {
    const counts = countDeliveryStates([
      { links: [] },
      { links: [taskLink("done")] },
      { links: [taskLink("open")] },
      { links: [taskLink("open"), taskLink("done")] },
      { links: [] },
    ]);
    expect(counts).toEqual({ no_task: 2, planned: 1, partial: 1, delivered: 1 });
  });
});
