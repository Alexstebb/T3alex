import * as Schema from "effect/Schema";

import type { EnvironmentId, ScheduledTaskId } from "@t3tools/contracts";

export const ScheduledTaskSection = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  collapsed: Schema.Boolean,
  taskKeys: Schema.Array(Schema.String),
});

export const ScheduledTaskOrganization = Schema.Struct({
  pinnedTaskKeys: Schema.Array(Schema.String),
  sections: Schema.Array(ScheduledTaskSection),
});

export const EMPTY_SCHEDULED_TASK_ORGANIZATION: ScheduledTaskOrganization = {
  pinnedTaskKeys: [],
  sections: [],
};

export type ScheduledTaskSection = typeof ScheduledTaskSection.Type;
export type ScheduledTaskOrganization = typeof ScheduledTaskOrganization.Type;

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
