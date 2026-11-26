import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

import { useAcknowledgeThreadWoke } from "../../hooks/useThreadActions";

/** The visit time that covers everything the thread has shown so far, even with a slow clock. */
function readVisitTime(
  thread: Pick<EnvironmentThreadShell, "updatedAt" | "latestRun">,
  now: number,
) {
  const times = [
    now,
    Date.parse(thread.updatedAt),
    Date.parse(thread.latestRun?.completedAt ?? ""),
  ];
  return new Date(Math.max(...times.filter((time) => !Number.isNaN(time)))).toISOString();
}

/**
 * Marks chats read the way opening them does: a visit the server records (or, on an older
 * server, the local visit time). Questions and approvals stay; they are not results.
 */
export function useMarkThreadsRead() {
  const visit = useAcknowledgeThreadWoke();
  return (threads: readonly EnvironmentThreadShell[]) => {
    const now = Date.now();
    for (const thread of threads) {
      visit(scopeThreadRef(thread.environmentId, thread.id), readVisitTime(thread, now));
    }
  };
}
