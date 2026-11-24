import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  isCompletedOneTimeScheduledTask,
  type EnvironmentId,
  type ScheduledTask,
} from "@t3tools/contracts";
import { T, useGT, useLocale, useMessages } from "gt-react";
import { PauseIcon, PencilIcon, PlayIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { useProject } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { scheduleLabel } from "../settings/scheduledTasksSettings.logic";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { ScheduledTaskDeleteDialog, useScheduledTaskActions } from "./scheduledTaskActions";
import { scheduledTaskState } from "./scheduledTaskOrganization";

export function ScheduledTaskInstructions({ task }: { readonly task: ScheduledTask }) {
  return (
    <div className="space-y-2 rounded-lg bg-muted/40 px-3 py-2.5 text-sm">
      <p className="whitespace-pre-wrap wrap-break-word text-muted-foreground">{task.prompt}</p>
      {task.lastRunError ? <p className="text-destructive">{task.lastRunError}</p> : null}
    </div>
  );
}

/** Title, schedule and the task's actions, on the task page and above a run's chat. */
export function ScheduledTaskHeader(props: {
  readonly environmentId: EnvironmentId;
  readonly task: ScheduledTask;
  readonly timeZone: string | undefined;
  readonly environmentLabel: string | null;
  /** Offer the instructions behind a Details toggle; the task page shows them itself. */
  readonly detailsToggle: boolean;
  readonly onEdit: () => void;
  readonly onDeleted: () => void;
}) {
  const { environmentId, task } = props;
  const gt = useGT();
  const messages = useMessages();
  const locale = useLocale();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const actions = useScheduledTaskActions(environmentId);
  const project = useProject(scopeProjectRef(environmentId, task.projectId));
  const [pending, setPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const completedOnce = isCompletedOneTimeScheduledTask(task);
  const runTask = useAtomCommand(serverEnvironment.runScheduledTaskNow, { reportFailure: false });
  const runNow = async () => {
    if (pending) return;
    setPending(true);
    const result = await runTask({ environmentId, input: { id: task.id } });
    setPending(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Could not update scheduled task"),
          description: String(squashAtomCommandFailure(result)),
        }),
      );
    }
  };
  return (
    <header className="space-y-2 border-b px-4 pt-4 pb-3">
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 text-base font-semibold wrap-break-word">{task.title}</h2>
        {props.detailsToggle ? (
          <Button
            size="xs"
            variant="ghost-muted"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((open) => !open)}
          >
            <T>Details</T>
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {project ? <span>{project.title} ·</span> : null}
        {props.environmentLabel ? <span>{props.environmentLabel} ·</span> : null}
        <span>
          {scheduleLabel(
            task.schedule,
            timestampFormat,
            props.timeZone,
            task.nextRunAt,
            messages,
            locale,
          )}
        </span>
        {!task.enabled ? (
          <Badge variant="outline">
            {completedOnce
              ? gt("Completed")
              : scheduledTaskState(task) === "not_started"
                ? gt("Not started")
                : gt("Paused")}
          </Badge>
        ) : null}
      </div>
      {actions.canEdit || actions.canPause || actions.canDelete ? (
        <div className="flex flex-wrap items-center gap-1">
          {actions.canEdit ? (
            <Button size="sm" variant="ghost" onClick={props.onEdit}>
              <PencilIcon className="size-3.5" />
              <T>Edit</T>
            </Button>
          ) : null}
          {actions.canEdit && task.schedule.type !== "webhook" && !completedOnce ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending || task.lastRunStatus === "running"}
              onClick={() => void runNow()}
            >
              <PlayIcon className="size-3.5" />
              <T>Run now</T>
            </Button>
          ) : null}
          {actions.canPause && !completedOnce ? (
            <Button size="sm" variant="ghost" onClick={() => void actions.toggleEnabled(task)}>
              {task.enabled ? (
                <PauseIcon className="size-3.5" />
              ) : (
                <PlayIcon className="size-3.5" />
              )}
              {task.enabled ? gt("Pause") : gt("Resume")}
            </Button>
          ) : null}
          {actions.canDelete ? (
            <Button size="sm" variant="ghost-destructive" onClick={() => setDeleting(true)}>
              <Trash2Icon className="size-3.5" />
              <T>Delete</T>
            </Button>
          ) : null}
        </div>
      ) : null}
      {props.detailsToggle && detailsOpen ? <ScheduledTaskInstructions task={task} /> : null}
      {deleting ? (
        <ScheduledTaskDeleteDialog
          task={task}
          onClose={() => setDeleting(false)}
          onDelete={async () => {
            if (await actions.deleteTask(task)) props.onDeleted();
          }}
        />
      ) : null}
    </header>
  );
}
