import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { AsyncResult } from "effect/reactivity";

import { environmentAtomList, environmentIdsKey } from "../../state/environmentAtomList";
import { useEnvironments } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useClientSettings } from "../../hooks/useSettings";
import { scheduledTaskListing, scheduledTaskOrganizationKey } from "./scheduledTaskOrganization";
import { useScheduledWorkspaceTasks } from "./useScheduledWorkspaceTasks";

const runThreadsAtom = environmentAtomList("web-scheduled-run-threads", (environmentId) =>
  serverEnvironment.scheduledTaskRunThreadsLive({ environmentId, input: {} }),
);

/**
 * The chats scheduled runs started, by scoped thread key, with the key of their task.
 * A server without the lookup (an older one) answers with nothing, so nothing is hidden.
 */
export function useScheduledRunThreads(): ReadonlyMap<string, string> {
  const { environments } = useEnvironments();
  const connected = environments
    .filter((entry) => entry.connection.phase === "connected" && entry.serverConfig !== null)
    .map((entry) => entry.environmentId);
  const results = useAtomValue(runThreadsAtom(environmentIdsKey(connected)));
  const taskKeyByThreadKey = new Map<string, string>();
  for (const [index, environmentId] of connected.entries()) {
    const result = results[index];
    if (result === undefined) continue;
    for (const { threadId, taskId } of AsyncResult.getOrElse(result, () => null)?.threads ?? []) {
      taskKeyByThreadKey.set(
        scopedThreadKey(scopeThreadRef(environmentId, threadId)),
        scheduledTaskOrganizationKey(environmentId, taskId),
      );
    }
  }
  return taskKeyByThreadKey;
}

/**
 * The run chats the Scheduled list stands in for: runs of tasks it still lists. Runs of a
 * deleted or aged-out task have no row there, so their chats keep their sidebar place.
 */
export function useScheduledListedRunThreadKeys(): ReadonlySet<string> {
  const taskKeyByThreadKey = useScheduledRunThreads();
  const { rows } = useScheduledWorkspaceTasks();
  const organization = useClientSettings((settings) => settings.scheduledTaskOrganization);
  const listed = scheduledTaskListing(organization, Date.parse(useNowMinute()));
  const listedTaskKeys = new Set(
    rows.flatMap(({ environmentId, task }) => {
      const key = scheduledTaskOrganizationKey(environmentId, task.id);
      return listed(key, task) ? [key] : [];
    }),
  );
  const keys = new Set<string>();
  for (const [threadKey, taskKey] of taskKeyByThreadKey) {
    if (listedTaskKeys.has(taskKey)) keys.add(threadKey);
  }
  return keys;
}
