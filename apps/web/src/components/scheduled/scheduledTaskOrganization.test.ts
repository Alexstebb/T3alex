import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentId, ScheduledTaskId } from "@t3tools/contracts";

import {
  EMPTY_SCHEDULED_TASK_ORGANIZATION,
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
