import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  AssistantCitation,
  EnvironmentId,
  MessageId,
  RunId,
  ScheduledTaskRun,
  ThreadId,
} from "@t3tools/contracts";
import type { useNavigate } from "@tanstack/react-router";
import { create } from "zustand";

interface ScheduledRunSelection {
  /** The run last opened in a thread that several runs share, by scoped thread key. */
  readonly pickedRunByThread: Readonly<Record<string, RunId>>;
  /** A shared-thread run to scroll to once its thread is on screen. */
  readonly pendingReveal: { readonly threadKey: string; readonly runId: RunId } | null;
}

export const useScheduledRunSelection = create<ScheduledRunSelection>(() => ({
  pickedRunByThread: {},
  pendingReveal: null,
}));

export function clearPendingRunReveal(threadKey: string) {
  useScheduledRunSelection.setState((state) =>
    state.pendingReveal?.threadKey === threadKey ? { pendingReveal: null } : state,
  );
}

/** The run a thread shows: the one opened there last, else the newest run that went to it. */
export function selectedScheduledRun(
  runs: readonly ScheduledTaskRun[],
  threadId: ThreadId,
  pickedRunId: RunId | undefined,
): ScheduledTaskRun | undefined {
  const inThread = runs.filter((run) => run.threadId === threadId);
  return inThread.find((run) => run.runId === pickedRunId) ?? inThread[0];
}

/** Opens a run's chat; in a thread other runs share, its reply is scrolled to once loaded. */
export function openScheduledRun(
  navigate: ReturnType<typeof useNavigate>,
  environmentId: EnvironmentId,
  run: ScheduledTaskRun,
  runs: readonly ScheduledTaskRun[],
  options: { readonly replace?: boolean } = {},
) {
  const threadKey = scopedThreadKey(scopeThreadRef(environmentId, run.threadId));
  const shared = runs.some((other) => other.threadId === run.threadId && other !== run);
  useScheduledRunSelection.setState((state) => ({
    pickedRunByThread: { ...state.pickedRunByThread, [threadKey]: run.runId },
    pendingReveal: shared ? { threadKey, runId: run.runId } : null,
  }));
  return navigate({
    to: "/$environmentId/$threadId",
    params: { environmentId, threadId: run.threadId },
    ...(options.replace ? { replace: true } : {}),
  });
}

const FENCED_CODE = /^ {0,3}(```|~~~)[^\n]*\n[\s\S]*?(?:\n {0,3}\1[^\n]*|$)/gm;
const INLINE_CODE = /`[^`\n]*`/g;
// Entities and escapes (`&amp;`, `\.`) render differently from their source.
const ENTITY_OR_ESCAPE = /&#?\w+;|\\./g;
// Letters, digits, spaces and sentence punctuation render as written in every markdown context.
const PLAIN_RUN = /[\p{L}\p{N}][\p{L}\p{N} ,.;:!?]{19,}/gu;
const MAX_SNIPPET_LENGTH = 80;

/** A stretch of the reply that renders verbatim and occurs once, to locate it in the chat. */
export function scheduledRunRevealSnippet(markdown: string): string | null {
  const prose = markdown
    .replace(FENCED_CODE, "\n")
    .replace(INLINE_CODE, "\n")
    .replace(ENTITY_OR_ESCAPE, "\n");
  for (const [match] of prose.matchAll(PLAIN_RUN)) {
    const space = match.lastIndexOf(" ", MAX_SNIPPET_LENGTH);
    const cut =
      match.length <= MAX_SNIPPET_LENGTH
        ? match
        : match.slice(0, space >= 20 ? space : MAX_SNIPPET_LENGTH);
    const snippet = cut.replace(/[ ,.;:!?]+$/u, "");
    if (snippet.length < 20) continue;
    const first = markdown.indexOf(snippet);
    if (first !== -1 && markdown.indexOf(snippet, first + 1) === -1) return snippet;
  }
  return null;
}

export function scheduledRunRevealCitation(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly text: string;
}): AssistantCitation | null {
  const snippet = scheduledRunRevealSnippet(input.text);
  if (snippet === null) return null;
  return {
    version: 1,
    environmentId: input.environmentId,
    threadId: input.threadId,
    messageId: input.messageId,
    text: snippet,
    start: 0,
    end: snippet.length,
    prefix: "",
    suffix: "",
  };
}
