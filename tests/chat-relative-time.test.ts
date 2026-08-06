import { describe, expect, it } from "vitest";
import { formatThreadTime } from "@/lib/chat/relative-time";

/**
 * The rail renders inside a client component, so the same input must produce
 * the same string on the server and at hydration — hence `now` as an argument
 * and an explicit locale for the fallback.
 */

const now = "2026-08-06T12:00:00.000Z";

describe("formatThreadTime", () => {
  it("reads anything under a minute as just now", () => {
    expect(formatThreadTime("2026-08-06T11:59:30.000Z", now)).toBe("just now");
  });

  it("counts minutes, hours, and days", () => {
    expect(formatThreadTime("2026-08-06T11:35:00.000Z", now)).toBe("25m ago");
    expect(formatThreadTime("2026-08-06T09:00:00.000Z", now)).toBe("3h ago");
    expect(formatThreadTime("2026-08-04T12:00:00.000Z", now)).toBe("2d ago");
  });

  it("switches to a date once a week has passed", () => {
    expect(formatThreadTime("2026-07-20T12:00:00.000Z", now)).toBe("20 Jul");
  });

  it("does not round a boundary up into the next bucket", () => {
    // Exactly 24h is one day, not "24h ago".
    expect(formatThreadTime("2026-08-05T12:00:00.000Z", now)).toBe("1d ago");
    // Exactly an hour is 1h, not 60m.
    expect(formatThreadTime("2026-08-06T11:00:00.000Z", now)).toBe("1h ago");
  });

  it("is stable regardless of the machine's timezone", () => {
    // A UTC-pinned fallback is what keeps server render and hydration equal.
    expect(formatThreadTime("2026-07-20T23:30:00.000Z", now)).toBe("20 Jul");
  });
});
