import {
  DEFAULT_COLLAPSED_SCHEDULED_TASK_GROUPS,
  isCompletedOneTimeScheduledTask,
  type EnvironmentId,
  type ScheduledTask,
  type ScheduledTaskGroupId,
  type ScheduledTaskId,
  type ScheduledTaskOrganization,
} from "@t3tools/contracts";

export { ScheduledTaskOrganization } from "@t3tools/contracts";
export type { ScheduledTaskSection } from "@t3tools/contracts";

export const EMPTY_SCHEDULED_TASK_ORGANIZATION: ScheduledTaskOrganization = {
  pinnedTaskKeys: [],
  sections: [],
  collapsedGroups: DEFAULT_COLLAPSED_SCHEDULED_TASK_GROUPS,
  lastSeenAt: {},
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

export function toggleScheduledTaskGroup(
  organization: ScheduledTaskOrganization,
  group: ScheduledTaskGroupId,
): ScheduledTaskOrganization {
  return {
    ...organization,
    collapsedGroups: organization.collapsedGroups.includes(group)
      ? organization.collapsedGroups.filter((candidate) => candidate !== group)
      : [...organization.collapsedGroups, group],
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

type ScheduledTaskResult = Pick<ScheduledTask, "lastRunAt" | "lastRunStatus">;

export function hasFinishedScheduledRun(task: ScheduledTaskResult): boolean {
  return task.lastRunStatus === "succeeded" || task.lastRunStatus === "failed";
}

/** A finished run the user has not seen yet; a task never seen counts as unread once. */
export function isScheduledTaskUnread(
  organization: ScheduledTaskOrganization,
  taskKey: string,
  task: ScheduledTaskResult,
): boolean {
  if (!hasFinishedScheduledRun(task) || task.lastRunAt === null) return false;
  const seenAt = organization.lastSeenAt[taskKey];
  return seenAt === undefined || Date.parse(task.lastRunAt) > Date.parse(seenAt);
}

/** Stores a time never earlier than the run, so a client clock behind the server cannot keep it unread. */
export function markScheduledTaskSeen(
  organization: ScheduledTaskOrganization,
  taskKey: string,
  task: ScheduledTaskResult,
  now: number,
): ScheduledTaskOrganization {
  if (!isScheduledTaskUnread(organization, taskKey, task) || task.lastRunAt === null) {
    return organization;
  }
  return {
    ...organization,
    lastSeenAt: {
      ...organization.lastSeenAt,
      [taskKey]: new Date(Math.max(now, Date.parse(task.lastRunAt))).toISOString(),
    },
  };
}

export function markScheduledTaskUnseen(
  organization: ScheduledTaskOrganization,
  taskKey: string,
): ScheduledTaskOrganization {
  if (!(taskKey in organization.lastSeenAt)) return organization;
  const { [taskKey]: _removed, ...lastSeenAt } = organization.lastSeenAt;
  return { ...organization, lastSeenAt };
}

/** Whether any task shown in the list has an unseen result; tasks aged out of the list do not count. */
export function hasUnreadScheduledTask(
  rows: readonly { readonly environmentId: EnvironmentId; readonly task: ScheduledTask }[],
  organization: ScheduledTaskOrganization,
  now: number,
): boolean {
  const sectioned = indexScheduledTaskSections(organization);
  return rows.some(({ environmentId, task }) => {
    const key = scheduledTaskOrganizationKey(environmentId, task.id);
    const listed =
      organization.pinnedTaskKeys.includes(key) ||
      sectioned.has(key) ||
      automaticScheduledGroup(task, now) !== "hidden";
    return listed && isScheduledTaskUnread(organization, key, task);
  });
}

/** Drops every trace of a deleted task: pin, subsection placement and last-seen time. */
export function forgetScheduledTask(
  organization: ScheduledTaskOrganization,
  taskKey: string,
): ScheduledTaskOrganization {
  const unseen = markScheduledTaskUnseen(organization, taskKey);
  return {
    ...unseen,
    pinnedTaskKeys: unseen.pinnedTaskKeys.filter((key) => key !== taskKey),
    sections: unseen.sections.map((section) =>
      section.taskKeys.includes(taskKey)
        ? { ...section, taskKeys: section.taskKeys.filter((key) => key !== taskKey) }
        : section,
    ),
  };
}

export function indexScheduledTaskSections(organization: ScheduledTaskOrganization) {
  return new Map(
    organization.sections.flatMap((section) =>
      section.taskKeys.map((key) => [key, section.id] as const),
    ),
  );
}
