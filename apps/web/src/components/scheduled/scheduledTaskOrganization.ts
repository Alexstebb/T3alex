import {
  isCompletedOneTimeScheduledTask,
  type EnvironmentId,
  type ScheduledTask,
  type ScheduledTaskId,
  type ScheduledTaskOrganization,
} from "@t3tools/contracts";

export { ScheduledTaskOrganization } from "@t3tools/contracts";
export type { ScheduledTaskSection } from "@t3tools/contracts";

export const EMPTY_SCHEDULED_TASK_ORGANIZATION: ScheduledTaskOrganization = {
  pinnedTaskKeys: [],
  sections: [],
};

/** Completed one-time tasks leave the list this long after their run. */
export const COMPLETED_TASK_VISIBLE_MS = 30 * 24 * 60 * 60 * 1000;

export type ScheduledTaskState = "active" | "paused" | "not_started" | "completed";

export function scheduledTaskState(task: ScheduledTask): ScheduledTaskState {
  if (isCompletedOneTimeScheduledTask(task)) return "completed";
  if (task.enabled) return "active";
  return task.runCount === 0 && task.lastRunStatus === "never" ? "not_started" : "paused";
}

/** Where a task lands when the user has not pinned it or put it in a subsection. */
export function automaticScheduledGroup(
  task: ScheduledTask,
  now: number,
): "upcoming" | "completed" | "hidden" | "all" {
  if (isCompletedOneTimeScheduledTask(task)) {
    const ranAt = task.lastRunAt === null ? Number.NaN : Date.parse(task.lastRunAt);
    return now - ranAt > COMPLETED_TASK_VISIBLE_MS ? "hidden" : "completed";
  }
  return task.schedule.type === "once" ? "upcoming" : "all";
}

export function scheduledTaskOrganizationKey(
  environmentId: EnvironmentId,
  taskId: ScheduledTaskId,
): string {
  return JSON.stringify([environmentId, taskId]);
}

export function toggleScheduledTaskPin(
  organization: ScheduledTaskOrganization,
  taskKey: string,
): ScheduledTaskOrganization {
  const pinned = organization.pinnedTaskKeys.includes(taskKey);
  return {
    ...organization,
    pinnedTaskKeys: pinned
      ? organization.pinnedTaskKeys.filter((key) => key !== taskKey)
      : [...organization.pinnedTaskKeys, taskKey],
  };
}

export function moveScheduledTaskToSection(
  organization: ScheduledTaskOrganization,
  taskKey: string,
  sectionId: string | null,
): ScheduledTaskOrganization {
  if (sectionId !== null && !organization.sections.some((section) => section.id === sectionId)) {
    return organization;
  }
  return {
    ...organization,
    sections: organization.sections.map((section) => {
      const withoutTask = section.taskKeys.filter((key) => key !== taskKey);
      return section.id === sectionId
        ? { ...section, taskKeys: [...withoutTask, taskKey] }
        : withoutTask.length === section.taskKeys.length
          ? section
          : { ...section, taskKeys: withoutTask };
    }),
  };
}

export function removeScheduledTaskSection(
  organization: ScheduledTaskOrganization,
  sectionId: string,
): ScheduledTaskOrganization {
  const sections = organization.sections.filter((section) => section.id !== sectionId);
  return sections.length === organization.sections.length
    ? organization
    : { ...organization, sections };
}

export function indexScheduledTaskSections(organization: ScheduledTaskOrganization) {
  return new Map(
    organization.sections.flatMap((section) =>
      section.taskKeys.map((key) => [key, section.id] as const),
    ),
  );
}
