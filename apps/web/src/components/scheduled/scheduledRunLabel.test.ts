import { describe, expect, it } from "vite-plus/test";

import { formatScheduledRunTime } from "./scheduledRunLabel";

const now = new Date(2026, 10, 24, 14, 0).getTime();
const at = (month: number, day: number, hour = 8, minute = 32) =>
  new Date(2026, month, day, hour, minute).toISOString();

describe("formatScheduledRunTime", () => {
  it("names today and yesterday, then falls back to the date", () => {
    expect(formatScheduledRunTime(at(10, 24), now, "24-hour", "en")).toBe("Today at 8:32");
    expect(formatScheduledRunTime(at(10, 23, 23, 59), now, "24-hour", "en")).toBe(
      "Yesterday at 23:59",
    );
    expect(formatScheduledRunTime(at(10, 20), now, "24-hour", "en")).toBe("Nov 20 at 8:32");
    expect(formatScheduledRunTime(at(10, 20), now, "12-hour", "en")).toMatch(
      /^Nov 20 at 8:32 a\.?m\.?$/i,
    );
  });

  it("adds the year for another year and follows the locale", () => {
    expect(
      formatScheduledRunTime(new Date(2025, 11, 31, 8, 32).toISOString(), now, "24-hour", "en"),
    ).toBe("Dec 31, 2025 at 8:32");
    expect(formatScheduledRunTime(at(10, 20), now, "24-hour", "en-GB")).toBe("20 Nov at 8:32");
  });
});
