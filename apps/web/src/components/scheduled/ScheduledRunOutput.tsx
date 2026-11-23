import { RegistryContext } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScheduledTask, ScheduledTaskRun } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import * as Option from "effect/Option";
import { T } from "gt-react";
import { ArrowUpRightIcon } from "lucide-react";
import { useContext, useEffect } from "react";

import { useProject } from "../../state/entities";
import { threadEnvironment, useEnvironmentThread } from "../../state/threads";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";

export function ScheduledRunOutput({
  environmentId,
  task,
  run,
}: {
  readonly environmentId: EnvironmentId;
  readonly task: ScheduledTask;
  readonly run: ScheduledTaskRun;
}) {
  const state = useEnvironmentThread(environmentId, run.threadId);
  const registry = useContext(RegistryContext);
  const project = useProject(scopeProjectRef(environmentId, task.projectId));
  const thread = Option.getOrNull(state.data);
  const messages = thread?.messages ?? [];
  const replies = messages.filter(
    (message) =>
      message.role === "assistant" &&
      (message.runId === run.runId || message.id === run.assistantMessageId) &&
      message.text,
  );
  const promptInHistory = messages.some((message) => message.id === run.userMessageId);
  const finished = ["completed", "failed", "cancelled", "interrupted", "rolled_back"].includes(
    run.status,
  );
  const canPage = thread !== null && state.history.hasMoreHistory && !promptInHistory;
  const historyTarget = run.assistantMessageId ?? run.userMessageId;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- requests the historical page containing the selected run when bounded chat history omitted it
  useEffect(() => {
    if (!canPage) return;
    void runAtomCommand(
      registry,
      threadEnvironment.loadEarlierHistory,
      { environmentId, input: { threadId: run.threadId, throughEntryId: historyTarget } },
      { label: "load scheduled run history", reportFailure: false },
    );
  }, [canPage, environmentId, historyTarget, registry, run.threadId]);

  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-4 px-5 py-5">
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="ghost-muted"
          render={
            <Link
              to="/$environmentId/$threadId"
              params={{ environmentId, threadId: run.threadId }}
            />
          }
        >
          <T>Open chat</T>
          <ArrowUpRightIcon className="size-3.5" />
        </Button>
      </div>
      {replies.map((message) => (
        <ChatMarkdown
          key={message.id}
          text={message.text}
          cwd={thread?.thread.worktreePath ?? project?.workspaceRoot}
          threadRef={scopeThreadRef(environmentId, run.threadId)}
          isStreaming={message.streaming}
          headingLevelOffset={2}
        />
      ))}
      {replies.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          {state.status === "deleted" || Option.isSome(state.error) || state.history.error ? (
            <T>This run is unavailable</T>
          ) : thread === null || state.history.loading ? (
            <T>Loading run…</T>
          ) : finished ? (
            <T>No response was recorded for this run.</T>
          ) : (
            <T>Waiting for a response…</T>
          )}
        </p>
      ) : null}
    </article>
  );
}
