import type { ScopedThreadRef } from "@t3tools/contracts";
import { useMessages } from "gt-react";

import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useScheduledWorkspaceTasks } from "./useScheduledWorkspaceTasks";

/** The scheduled task whose runs went to this thread, with all of that task's runs. */
export function useScheduledThreadTask(threadRef: ScopedThreadRef | null) {
  const messages = useMessages();
  const workspace = useScheduledWorkspaceTasks();
  const environmentId = threadRef?.environmentId;
  // Environments without tasks skip the lookup, so ordinary chats cost nothing.
  const hasTasks = workspace.rows.some((row) => row.environmentId === environmentId);
  const lookup = useEnvironmentQuery(
    threadRef !== null && hasTasks
      ? serverEnvironment.scheduledTaskRunsLive({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        })
      : null,
    messages,
  );
  const taskId = lookup.data?.taskId ?? null;
  const row =
    taskId === null
      ? undefined
      : workspace.rows.find(
          (item) => item.environmentId === environmentId && item.task.id === taskId,
        );
  const source = workspace.sources.find((item) => item.environment.environmentId === environmentId);
  return {
    row,
    runs: row === undefined ? [] : (lookup.data?.runs ?? []),
    lookup,
    environmentLabel:
      workspace.environmentCount > 1 && source !== undefined ? source.environment.label : null,
  };
}
