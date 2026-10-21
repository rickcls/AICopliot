import { describe, expect, it } from "vitest";
import { greetingPeriod } from "@/lib/time";

/**
 * The Today greeting follows the viewer's clock, not the server's. Vercel runs
 * in UTC, so reading the server's hour would greet Hong Kong with "good
 * morning" at 4 pm.
 */
describe("greetingPeriod", () => {
  it("reads the hour in the viewer's zone", () => {
    // 07:00, 13:00 and 22:00 in Hong Kong (UTC+8).
    expect(greetingPeriod("Asia/Hong_Kong", new Date("2026-10-20T23:00:00Z"))).toBe("morning");
    expect(greetingPeriod("Asia/Hong_Kong", new Date("2026-10-21T05:00:00Z"))).toBe("afternoon");
    expect(greetingPeriod("Asia/Hong_Kong", new Date("2026-10-21T14:00:00Z"))).toBe("evening");
  });

  it("says good evening at 01:00 in Hong Kong, while it is still yesterday in UTC", () => {
    expect(greetingPeriod("Asia/Hong_Kong", new Date("2026-10-20T17:00:00Z"))).toBe("evening");
  });

  it("changes at 05:00, 12:00 and 18:00 exactly", () => {
    expect(greetingPeriod("UTC", new Date("2026-10-21T04:59:00Z"))).toBe("evening");
    expect(greetingPeriod("UTC", new Date("2026-10-21T05:00:00Z"))).toBe("morning");
    expect(greetingPeriod("UTC", new Date("2026-10-21T12:00:00Z"))).toBe("afternoon");
    expect(greetingPeriod("UTC", new Date("2026-10-21T18:00:00Z"))).toBe("evening");
  });

  it("falls back to Hong Kong for an invalid zone", () => {
    expect(greetingPeriod("Not/AZone", new Date("2026-10-20T23:00:00Z"))).toBe("morning");
  });
});
