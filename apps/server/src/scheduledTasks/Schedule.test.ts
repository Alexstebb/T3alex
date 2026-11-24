import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { isSameSchedule, nextScheduledRunAt } from "./Schedule.ts";

describe("scheduled task schedule calculation", () => {
  it("skips to the next matching fixed-time weekday", () => {
    const next = nextScheduledRunAt(
      { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2, 3, 4, 5] },
      DateTime.makeZonedUnsafe(
        {
          year: 2026,
          month: 7,
          day: 3,
          hour: 10,
          minute: 0,
          second: 0,
          millisecond: 0,
        },
        { timeZone: "America/Los_Angeles", adjustForTimeZone: true },
      ),
    );
    const parts = next ? DateTime.toParts(next) : null;
    expect(parts?.weekDay).toBe(1);
    expect(parts?.hour).toBe(9);
    expect(parts?.minute).toBe(0);
  });

  it("picks the earliest of several fixed times", () => {
    const zoned = (day: number, hour: number, minute: number) =>
      DateTime.makeZonedUnsafe(
        { year: 2026, month: 11, day, hour, minute, second: 0, millisecond: 0 },
        { timeZone: "Europe/Oslo", adjustForTimeZone: true },
      );
    const schedule = {
      type: "fixed_time" as const,
      timeOfDay: "10:15",
      additionalTimesOfDay: ["14:15", "12:15"],
      weekdays: [1, 2, 3, 4, 5],
    };
    // Monday 23 November 2026, between the second and third time.
    const midday = nextScheduledRunAt(schedule, zoned(23, 12, 30));
    expect(midday && DateTime.toParts(midday)).toMatchObject({ day: 23, hour: 14, minute: 15 });
    // After the last time on Friday, the next run is Monday at the first time.
    const weekend = nextScheduledRunAt(schedule, zoned(27, 15, 0));
    expect(weekend && DateTime.toParts(weekend)).toMatchObject({ day: 30, hour: 10, minute: 15 });
  });

  it("treats the same set of fixed times as the same schedule", () => {
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "10:15", additionalTimesOfDay: ["12:15"] },
        { type: "fixed_time", timeOfDay: "12:15", additionalTimesOfDay: ["10:15", "10:15"] },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "10:15", additionalTimesOfDay: ["12:15"] },
        { type: "fixed_time", timeOfDay: "10:15" },
      ),
    ).toBe(false);
  });

  it("compares schedules structurally", () => {
    expect(
      isSameSchedule(
        { type: "once", runAt: "2026-11-01T03:00:00-05:00" },
        { type: "once", runAt: "2026-11-01T08:00:00.000Z" },
      ),
    ).toBe(true);
    expect(
      isSameSchedule({ type: "interval", everyMs: 60_000 }, { type: "interval", everyMs: 60_000 }),
    ).toBe(true);
    expect(
      isSameSchedule({ type: "interval", everyMs: 60_000 }, { type: "interval", everyMs: 30_000 }),
    ).toBe(false);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2] },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2] },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [5, 1] },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 5, 5] },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00" },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [] },
        { type: "fixed_time", timeOfDay: "09:00" },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2] },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 3] },
      ),
    ).toBe(false);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00" },
        { type: "fixed_time", timeOfDay: "09:30" },
      ),
    ).toBe(false);
    expect(
      isSameSchedule(
        { type: "interval", everyMs: 60_000 },
        { type: "fixed_time", timeOfDay: "09:00" },
      ),
    ).toBe(false);
  });
});
