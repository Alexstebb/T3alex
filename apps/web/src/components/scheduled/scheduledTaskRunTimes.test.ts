import {
  ProjectId,
  ProviderInstanceId,
  ScheduledTaskId,
  type ScheduledTask,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  scheduleFromDraft,
  scheduleLabel,
  taskToDraft,
} from "../settings/scheduledTasksSettings.logic";
import { newDraftTime } from "./scheduledTaskRunTimes";

const task: ScheduledTask = {
  id: ScheduledTaskId.make("legacy-task"),
  title: "Review issues",
  prompt: "Review open issues",
  enabled: true,
  schedule: { type: "interval", everyMs: 60_000 },
  projectId: ProjectId.make("project"),
  threadId: null,
  workspaceStrategy: { type: "worktree", baseRef: "release" },
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  createdBy: "user",
  creationSource: "web",
  createdAt: "2026-09-17T00:00:00.000Z",
  updatedAt: "2026-09-17T00:00:00.000Z",
  nextRunAt: null,
  lastRunAt: null,
  lastRunStatus: "never",
  lastRunError: null,
  runCount: 0,
};

describe("fixed-time scheduled tasks", () => {
  it("keeps extra run times and drops empty or repeated ones", () => {
    const draft = taskToDraft({
      ...task,
      schedule: { type: "fixed_time", timeOfDay: "10:15", additionalTimesOfDay: ["9:15"] },
    });
    expect(draft.additionalTimes?.map(({ time }) => time)).toEqual(["09:15"]);
    expect(
      scheduleFromDraft({
        ...draft,
        additionalTimes: ["09:15", "", "10:15", "09:15", "14:15"].map((time) => newDraftTime(time)),
      }),
    ).toEqual({
      type: "fixed_time",
      timeOfDay: "10:15",
      additionalTimesOfDay: ["09:15", "14:15"],
    });
    expect(scheduleFromDraft({ ...draft, additionalTimes: [newDraftTime()] })).toEqual({
      type: "fixed_time",
      timeOfDay: "10:15",
    });
  });
});

// The host locale's clock for a wall time, so this passes in any locale.
function clock(hour12: boolean, hour: number, minute: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12,
    timeZone: "UTC",
  }).format(Date.UTC(2000, 0, 1, hour, minute));
}

it("lists extra run times after the main one in the schedule label", () => {
  const daily = { type: "fixed_time", timeOfDay: "17:30" } as const;
  expect(scheduleLabel({ ...daily, additionalTimesOfDay: ["9:15"] }, "12-hour")).toBe(
    `Daily at ${clock(true, 17, 30)}, ${clock(true, 9, 15)}`,
  );
});
