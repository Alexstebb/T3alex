import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ScheduledTask } from "@t3tools/contracts";

import { useQuietThreadShells } from "../../state/entities";
import { useUiStateStore } from "../../uiStateStore";
import {
  isReadClearableTone,
  sectionLampToneOfVisitedThread,
  type SectionLampTone,
} from "../sidebar/sidebarSectionLamp.logic";
import { moreUrgentLampTone, scheduledTaskOrganizationKey } from "./scheduledTaskOrganization";
import { useScheduledRunThreads } from "./useScheduledRunThreads";

export interface ScheduledChatState {
  /** The most urgent state among the task's run chats, apart from an unread reply. */
  readonly tone: SectionLampTone | null;
  /** The chat that state comes from. */
  readonly thread: EnvironmentThreadShell | null;
  /** Run chats with an unread reply or unseen failure, for "Mark all as read". */
  readonly unreadThreads: readonly EnvironmentThreadShell[];
}

/**
 * What a task's run chats say, per task key. A chat belongs to a task when a run of it
 * started the chat, or when the task continues in it. An unread reply is left to the
 * task's own seen state, so the Scheduled list keeps one way to read a result.
 */
export function scheduledChatStates(input: {
  readonly rows: readonly { readonly environmentId: EnvironmentId; readonly task: ScheduledTask }[];
  readonly threads: readonly EnvironmentThreadShell[];
  readonly taskKeyByThreadKey: ReadonlyMap<string, string>;
  readonly toneOf: (thread: EnvironmentThreadShell) => SectionLampTone | null;
}): ReadonlyMap<string, ScheduledChatState> {
  const continuedIn = new Map<string, string>();
  for (const { environmentId, task } of input.rows) {
    if (task.threadId === null) continue;
    continuedIn.set(
      scopedThreadKey(scopeThreadRef(environmentId, task.threadId)),
      scheduledTaskOrganizationKey(environmentId, task.id),
    );
  }
  const states = new Map<string, ScheduledChatState>();
  for (const thread of input.threads) {
    const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    const taskKey = input.taskKeyByThreadKey.get(threadKey) ?? continuedIn.get(threadKey);
    if (taskKey === undefined) continue;
    const tone = input.toneOf(thread);
    if (tone === null) continue;
    const current = states.get(taskKey) ?? { tone: null, thread: null, unreadThreads: [] };
    const chatTone = tone === "done" ? null : tone;
    const winner = moreUrgentLampTone(current.tone, chatTone);
    states.set(taskKey, {
      tone: winner,
      thread: winner !== current.tone ? thread : current.thread,
      unreadThreads: isReadClearableTone(tone)
        ? [...current.unreadThreads, thread]
        : current.unreadThreads,
    });
  }
  return states;
}

export function useScheduledChatStates(
  rows: readonly { readonly environmentId: EnvironmentId; readonly task: ScheduledTask }[],
) {
  const threads = useQuietThreadShells();
  const taskKeyByThreadKey = useScheduledRunThreads();
  const localLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  return scheduledChatStates({
    rows,
    threads,
    taskKeyByThreadKey,
    toneOf: (thread) =>
      sectionLampToneOfVisitedThread(
        thread,
        localLastVisitedAtById[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))],
      ),
  });
}
