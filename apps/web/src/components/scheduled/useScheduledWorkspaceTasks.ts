import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useMessages } from "gt-react";

import { environmentAtomList, environmentIdsKey } from "../../state/environmentAtomList";
import { useEnvironments } from "../../state/environments";
import { formatEnvironmentQueryError } from "../../state/query";
import { serverEnvironment } from "../../state/server";

const tasksAtom = environmentAtomList("web-scheduled-workspace-tasks", (environmentId) =>
  serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
);

export function useScheduledWorkspaceTasks() {
  const messages = useMessages();
  const { environments, isReady } = useEnvironments();
  const connected = environments.filter(
    (entry) => entry.connection.phase === "connected" && entry.serverConfig !== null,
  );
  const queries = useAtomValue(
    tasksAtom(environmentIdsKey(connected.map((entry) => entry.environmentId))),
  );
  const sources = connected.map(({ environmentId, label }, index) => {
    const query = queries[index]!;
    return {
      environment: { environmentId, label },
      data: AsyncResult.getOrElse(query, () => null),
      error: query._tag === "Failure" ? formatEnvironmentQueryError(query.cause, messages) : null,
    };
  });
  const rows = sources.flatMap(({ environment, data }) =>
    (data?.tasks ?? []).map((task) => ({
      environmentId: environment.environmentId,
      timeZone: data?.timeZone,
      task,
    })),
  );
  return { rows, sources, environmentCount: environments.length, isReady };
}
