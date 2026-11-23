import { EnvironmentId, RunId, ScheduledTaskId } from "@t3tools/contracts";

interface ScheduledWorkspaceSearch {
  readonly environmentId?: EnvironmentId;
  readonly taskId?: ScheduledTaskId;
  readonly runId?: RunId;
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
  if (environmentId === undefined || taskId === undefined) return {};

  const runId =
    typeof raw.runId === "string" && raw.runId.trim() ? RunId.make(raw.runId) : undefined;
  return { environmentId, taskId, ...(runId === undefined ? {} : { runId }) };
}
