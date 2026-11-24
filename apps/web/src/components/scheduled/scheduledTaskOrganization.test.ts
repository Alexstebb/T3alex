import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentId, ScheduledTask, ScheduledTaskId } from "@t3tools/contracts";

import {
  automaticScheduledGroup,
  COMPLETED_TASK_VISIBLE_MS,
  EMPTY_SCHEDULED_TASK_ORGANIZATION,
  scheduledTaskState,
  indexScheduledTaskSections,
  moveScheduledTaskToSection,
  removeScheduledTaskSection,
  scheduledTaskOrganizationKey,
  toggleScheduledTaskPin,
  type ScheduledTaskOrganization,
} from "./scheduledTaskOrganization";

const organization: ScheduledTaskOrganization = {
  pinnedTaskKeys: [],
  sections: [
    { id: "morning", name: "Morning", collapsed: false, taskKeys: ["task-a"] },
    { id: "follow-up", name: "Follow-up", collapsed: false, taskKeys: [] },
  ],
};

describe("scheduled task organization", () => {
  it("scopes task keys to their environment", () => {
    const taskId = "same" as ScheduledTaskId;
    expect(scheduledTaskOrganizationKey("local" as EnvironmentId, taskId)).not.toBe(
      scheduledTaskOrganizationKey("remote" as EnvironmentId, taskId),
    );
  });

  it("pins and unpins without changing section placement", () => {
    const pinned = toggleScheduledTaskPin(organization, "task-a");
    expect(pinned.pinnedTaskKeys).toEqual(["task-a"]);
    expect(indexScheduledTaskSections(pinned).get("task-a")).toBe("morning");
    expect(toggleScheduledTaskPin(pinned, "task-a")).toEqual(organization);
  });

  it("moves a task between sections and back to the unsectioned list", () => {
    const moved = moveScheduledTaskToSection(organization, "task-a", "follow-up");
    expect(indexScheduledTaskSections(moved).get("task-a")).toBe("follow-up");
    expect(
      indexScheduledTaskSections(moveScheduledTaskToSection(moved, "task-a", null)).has("task-a"),
    ).toBe(false);
  });

  it("removes a section without losing pinned state", () => {
    const pinned = toggleScheduledTaskPin(organization, "task-a");
    expect(removeScheduledTaskSection(pinned, "morning")).toEqual({
      pinnedTaskKeys: ["task-a"],
      sections: [organization.sections[1]],
    });
  });

  it("keeps the shared empty organization immutable", () => {
    const pinned = toggleScheduledTaskPin(EMPTY_SCHEDULED_TASK_ORGANIZATION, "task-a");
    expect(EMPTY_SCHEDULED_TASK_ORGANIZATION.pinnedTaskKeys).toEqual([]);
    expect(pinned.pinnedTaskKeys).toEqual(["task-a"]);
  });
});

const baseTask = {
  enabled: false,
  schedule: { type: "fixed_time", timeOfDay: "09:00" },
  nextRunAt: null,
  lastRunAt: null,
  lastRunStatus: "never",
  runCount: 0,
} as unknown as ScheduledTask;
const now = Date.parse("2026-11-23T12:00:00.000Z");

describe("scheduled task grouping", () => {
  it("tells tasks that never ran from paused and completed ones", () => {
    expect(scheduledTaskState(baseTask)).toBe("not_started");
    expect(scheduledTaskState({ ...baseTask, enabled: true })).toBe("active");
    expect(
      scheduledTaskState({ ...baseTask, lastRunStatus: "failed", runCount: 1 } as ScheduledTask),
    ).toBe("paused");
    const completed = {
      ...baseTask,
      schedule: { type: "once", runAt: "2026-11-20T08:00:00.000Z" },
      lastRunAt: "2026-11-20T08:00:05.000Z",
      lastRunStatus: "succeeded",
      runCount: 1,
    } as ScheduledTask;
    expect(scheduledTaskState(completed)).toBe("completed");
    expect(automaticScheduledGroup(completed, now)).toBe("completed");
    expect(automaticScheduledGroup(completed, now + COMPLETED_TASK_VISIBLE_MS)).toBe("hidden");
  });

  it("puts pending one-time tasks under upcoming and recurring ones under all tasks", () => {
    const upcoming = {
      ...baseTask,
      schedule: { type: "once", runAt: "2027-01-04T08:45:00.000Z" },
    } as ScheduledTask;
    expect(automaticScheduledGroup(upcoming, now)).toBe("upcoming");
    expect(automaticScheduledGroup(baseTask, now)).toBe("all");
  });
});
