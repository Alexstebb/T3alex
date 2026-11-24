import { fixedTimesOfDay, type ScheduledTask } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";

import { formatTimeOfDay } from "../../timestampFormat";

// Extra run times on the same days as a fixed-time schedule (`additionalTimesOfDay`).

export interface DraftTime {
  /** Stable while editing, so an input keeps its focus while its value changes. */
  readonly id: string;
  readonly time: string;
}

let nextDraftTimeId = 0;

export function newDraftTime(time = ""): DraftTime {
  nextDraftTimeId += 1;
  return { id: `time-${nextDraftTimeId}`, time };
}

// The main time first, then the extra ones.
export function formatFixedTimesOfDay(
  schedule: Parameters<typeof fixedTimesOfDay>[0],
  timestampFormat: TimestampFormat,
) {
  return fixedTimesOfDay(schedule)
    .map((timeOfDay) => formatTimeOfDay(timeOfDay, timestampFormat))
    .join(", ");
}

export function draftTimesFromSchedule(schedule: ScheduledTask["schedule"]): readonly DraftTime[] {
  return schedule.type === "fixed_time"
    ? (schedule.additionalTimesOfDay ?? []).map((time) => newDraftTime(time.padStart(5, "0")))
    : [];
}

// Empty entries and repeats of the main time are dropped.
export function additionalTimesOfDayFromDraft(draft: {
  readonly timeOfDay: string;
  readonly additionalTimes?: readonly DraftTime[];
}): { readonly additionalTimesOfDay?: string[] } {
  const additionalTimesOfDay = [
    ...new Set(
      (draft.additionalTimes ?? [])
        .map(({ time }) => time)
        .filter((time) => time && time !== draft.timeOfDay),
    ),
  ];
  return additionalTimesOfDay.length > 0 ? { additionalTimesOfDay } : {};
}
