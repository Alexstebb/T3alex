import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentId, ScheduledTask, ScheduledTaskId } from "@t3tools/contracts";

import {
  automaticScheduledGroup,
  COMPLETED_TASK_VISIBLE_MS,
  EMPTY_SCHEDULED_TASK_ORGANIZATION,
  forgetScheduledTask,
  hasUnreadScheduledTask,
  isScheduledTaskUnread,
  markScheduledTaskSeen,
  markScheduledTaskUnseen,
  scheduledTaskState,
  indexScheduledTaskSections,
  moveScheduledTaskToSection,
  removeScheduledTaskSection,
  scheduledTaskOrganizationKey,
  toggleScheduledTaskGroup,
  toggleScheduledTaskPin,
  ScheduledTaskOrganization,
} from "./scheduledTaskOrganization";

const decodeOrganization = Schema.decodeUnknownSync(ScheduledTaskOrganization);

const organization: ScheduledTaskOrganization = {
  pinnedTaskKeys: [],
  collapsedGroups: ["completed"],
  lastSeenAt: {},
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
      collapsedGroups: ["completed"],
      lastSeenAt: {},
      sections: [organization.sections[1]],
    });
  });

  it("collapses and reopens a group without touching the rest", () => {
    const collapsed = toggleScheduledTaskGroup(organization, "all");
    expect(collapsed.collapsedGroups).toEqual(["completed", "all"]);
    expect(toggleScheduledTaskGroup(collapsed, "completed").collapsedGroups).toEqual(["all"]);
    expect(collapsed.sections).toBe(organization.sections);
  });

  it("decodes saved organizations without collapsed groups as collapsing Completed only", () => {
    const decoded = decodeOrganization({
      pinnedTaskKeys: [],
      sections: [],
    });
    expect(decoded.collapsedGroups).toEqual(["completed"]);
  });

  it("decodes saved organizations without last-seen times as having seen nothing", () => {
    const decoded = decodeOrganization({
      pinnedTaskKeys: ["task-a"],
      sections: [],
      collapsedGroups: [],
    });
    expect(decoded.lastSeenAt).toEqual({});
    expect(decoded.pinnedTaskKeys).toEqual(["task-a"]);
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

describe("unread scheduled results", () => {
  const finished = (lastRunAt: string, lastRunStatus: "succeeded" | "failed" = "succeeded") =>
    ({ lastRunAt, lastRunStatus }) as const;
  const first = finished("2026-11-23T08:00:00.000Z");
  const second = finished("2026-11-24T08:00:00.000Z");
  const seenAfterFirst = markScheduledTaskSeen(
    organization,
    "task-a",
    first,
    Date.parse("2026-11-23T09:00:00.000Z"),
  );

  it("counts a finished run as unread until it has been seen, then again after the next one", () => {
    expect(isScheduledTaskUnread(organization, "task-a", first)).toBe(true);
    expect(isScheduledTaskUnread(seenAfterFirst, "task-a", first)).toBe(false);
    expect(isScheduledTaskUnread(seenAfterFirst, "task-a", second)).toBe(true);
    expect(
      isScheduledTaskUnread(seenAfterFirst, "task-a", finished(second.lastRunAt, "failed")),
    ).toBe(true);
  });

  it("ignores tasks without a finished run", () => {
    for (const task of [
      { lastRunAt: null, lastRunStatus: "never" },
      { lastRunAt: second.lastRunAt, lastRunStatus: "running" },
    ] as const) {
      expect(isScheduledTaskUnread(organization, "task-a", task)).toBe(false);
    }
  });

  it("never stores a seen time earlier than the run, even with a clock running behind", () => {
    const behind = markScheduledTaskSeen(organization, "task-a", second, 0);
    expect(behind.lastSeenAt["task-a"]).toBe(second.lastRunAt);
    expect(isScheduledTaskUnread(behind, "task-a", second)).toBe(false);
  });

  it("leaves the organization untouched when there is nothing new to mark", () => {
    expect(markScheduledTaskSeen(seenAfterFirst, "task-a", first, now)).toBe(seenAfterFirst);
    expect(markScheduledTaskUnseen(organization, "task-a")).toBe(organization);
  });

  it("marks a result unread again by forgetting when it was seen", () => {
    const unseen = markScheduledTaskUnseen(seenAfterFirst, "task-a");
    expect(isScheduledTaskUnread(unseen, "task-a", first)).toBe(true);
  });

  it("forgets pin, subsection and seen time of a deleted task and nothing else", () => {
    const keep = markScheduledTaskSeen(seenAfterFirst, "task-b", first, now);
    const pinned = toggleScheduledTaskPin(keep, "task-a");
    expect(forgetScheduledTask(pinned, "task-a")).toEqual({
      ...organization,
      lastSeenAt: { "task-b": keep.lastSeenAt["task-b"] },
      sections: [{ ...organization.sections[0], taskKeys: [] }, organization.sections[1]],
    });
    expect(forgetScheduledTask(organization, "missing")).toEqual(organization);
  });

  it("flags the Scheduled header only for tasks that are still listed", () => {
    const environmentId = "local" as EnvironmentId;
    const old = {
      ...baseTask,
      id: "old" as ScheduledTaskId,
      schedule: { type: "once", runAt: "2026-01-01T08:00:00.000Z" },
      enabled: false,
      lastRunAt: "2026-01-01T08:00:05.000Z",
      lastRunStatus: "succeeded",
      runCount: 1,
    } as ScheduledTask;
    const rows = [{ environmentId, task: old }];
    expect(hasUnreadScheduledTask(rows, organization, now)).toBe(false);
    const key = scheduledTaskOrganizationKey(environmentId, old.id);
    expect(hasUnreadScheduledTask(rows, { ...organization, pinnedTaskKeys: [key] }, now)).toBe(
      true,
    );
    const recent = {
      ...old,
      id: "recent" as ScheduledTaskId,
      lastRunAt: "2026-11-22T08:00:00.000Z",
    };
    expect(hasUnreadScheduledTask([{ environmentId, task: recent }], organization, now)).toBe(true);
  });
});
