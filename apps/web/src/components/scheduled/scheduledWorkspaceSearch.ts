import { EnvironmentId, ScheduledTaskId } from "@t3tools/contracts";

interface ScheduledWorkspaceSearch {
  readonly environmentId?: EnvironmentId;
  readonly taskId?: ScheduledTaskId;
}

export function validateScheduledWorkspaceSearch(
  raw: Record<string, unknown>,
): ScheduledWorkspaceSearch {
  const environmentId =
    typeof raw.environmentId === "string" && raw.environmentId.trim()
      ? EnvironmentId.make(raw.environmentId)
      : undefined;
  const taskId =
    typeof raw.taskId === "string" && raw.taskId.trim()
      ? ScheduledTaskId.make(raw.taskId)
      : undefined;
  return environmentId === undefined || taskId === undefined ? {} : { environmentId, taskId };
}
