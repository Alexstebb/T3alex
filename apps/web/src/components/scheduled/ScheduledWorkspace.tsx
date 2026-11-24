import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  isCompletedOneTimeScheduledTask,
  type EnvironmentId,
  type ScheduledTask,
  type ScheduledTaskRun,
} from "@t3tools/contracts";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { msg, T, useGT, useLocale, useMessages } from "gt-react";
import {
  CalendarClockIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { Suspense, useEffect, useState } from "react";

import { isElectron } from "../../env";
import {
  getClientSettings,
  persistClientSettingsPatch,
  useClientSettings,
} from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { useProject } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { environmentAtomList, environmentIdsKey } from "../../state/environmentAtomList";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { scheduleLabel } from "../settings/scheduledTasksSettings.logic";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { ScheduledRunOutput } from "./ScheduledRunOutput";
import { formatScheduledRunTime } from "./scheduledRunLabel";
import {
  ScheduledTaskDeleteDialog,
  ScheduledTaskEditor,
  useScheduledTaskActions,
} from "./scheduledTaskActions";
import {
  markScheduledTaskSeen,
  scheduledTaskOrganizationKey,
  scheduledTaskState,
} from "./scheduledTaskOrganization";
import { useScheduledWorkspaceTasks } from "./useScheduledWorkspaceTasks";

const route = getRouteApi("/_chat/scheduled");

const runLabels = {
  preparing: msg("Preparing"),
  queued: msg("Queued"),
  starting: msg("Starting"),
  running: msg("Running"),
  waiting: msg("Waiting"),
  completed: msg("Completed"),
  interrupted: msg("Interrupted"),
  failed: msg("Failed"),
  cancelled: msg("Cancelled"),
  rolled_back: msg("Rolled back"),
} satisfies Record<ScheduledTaskRun["status"], string>;

interface RunListProps {
  readonly runs: readonly ScheduledTaskRun[];
  readonly selected: ScheduledTaskRun | undefined;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onSelect: (run: ScheduledTaskRun) => void;
  readonly onRetry: () => void;
}

function useRunTimeLabel() {
  const locale = useLocale();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const nowMs = Date.parse(useNowMinute());
  return (requestedAt: string) =>
    formatScheduledRunTime(requestedAt, nowMs, timestampFormat, locale);
}

function RunList({ runs, selected, loading, error, onSelect, onRetry }: RunListProps) {
  const messages = useMessages();
  const runTime = useRunTimeLabel();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
      {error !== null ? (
        <div className="space-y-1 px-2 py-1.5 text-xs">
          <p role="status" className="text-destructive">
            {error}
          </p>
          <Button variant="ghost" size="xs" onClick={onRetry}>
            <T>Retry</T>
          </Button>
        </div>
      ) : null}
      {runs.length === 0 && error === null ? (
        <p role="status" className="px-2 py-1.5 text-xs text-muted-foreground">
          {loading ? <T>Loading runs…</T> : <T>No runs yet</T>}
        </p>
      ) : null}
      <ul className="space-y-1.5">
        {runs.map((run) => (
          <li key={run.runId}>
            <button
              type="button"
              aria-current={selected?.runId === run.runId ? "true" : undefined}
              className={cn(
                "flex w-full cursor-pointer items-center gap-3 rounded-lg bg-muted/40 px-3 py-2.5 text-left text-sm outline-none hover:bg-accent/65 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                selected?.runId === run.runId && "bg-accent text-accent-foreground",
              )}
              onClick={() => onSelect(run)}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <time dateTime={run.requestedAt} className="truncate">
                  {runTime(run.requestedAt)}
                </time>
                <span
                  className={cn(
                    "text-xs text-muted-foreground",
                    run.status === "failed" && "text-destructive",
                    run.status === "running" && "font-medium text-info-foreground",
                  )}
                >
                  {messages(runLabels[run.status])}
                </span>
              </span>
              <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Below the two-column breakpoint the runs fold into a section above the output. */
function RunsDisclosure(props: RunListProps) {
  const [open, setOpen] = useState(false);
  const runTime = useRunTimeLabel();
  return (
    <div className="border-b lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronDownIcon
          aria-hidden
          className={cn("size-3.5 shrink-0 transition-transform", !open && "-rotate-90")}
        />
        <span className="font-medium">
          <T>Runs</T>
        </span>
        <span className="tabular-nums text-muted-foreground">{props.runs.length}</span>
        {props.selected ? (
          <span className="min-w-0 flex-1 truncate text-right text-muted-foreground">
            {runTime(props.selected.requestedAt)}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="flex max-h-72 flex-col">
          <RunList
            {...props}
            onSelect={(run) => {
              setOpen(false);
              props.onSelect(run);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function TaskInstructions({ task }: { readonly task: ScheduledTask }) {
  return (
    <div className="space-y-2 rounded-lg bg-muted/40 px-3 py-2.5 text-sm">
      <p className="whitespace-pre-wrap wrap-break-word text-muted-foreground">{task.prompt}</p>
      {task.lastRunError ? <p className="text-destructive">{task.lastRunError}</p> : null}
    </div>
  );
}

function TaskHeader(props: {
  readonly environmentId: EnvironmentId;
  readonly task: ScheduledTask;
  readonly timeZone: string | undefined;
  readonly environmentLabel: string | null;
  readonly hasRuns: boolean;
  readonly detailsOpen: boolean;
  readonly onToggleDetails: () => void;
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
        {props.hasRuns ? (
          <Button
            size="xs"
            variant="ghost-muted"
            aria-expanded={props.detailsOpen}
            onClick={props.onToggleDetails}
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
      {actions.canEdit || actions.canDelete ? (
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
          {actions.canDelete ? (
            <Button size="sm" variant="ghost-destructive" onClick={() => setDeleting(true)}>
              <Trash2Icon className="size-3.5" />
              <T>Delete</T>
            </Button>
          ) : null}
        </div>
      ) : null}
      {props.detailsOpen && props.hasRuns ? <TaskInstructions task={task} /> : null}
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

const canCreateAtom = environmentAtomList(
  "web-scheduled-workspace-permissions",
  serverEnvironment.upsertScheduledTask.permissionAtom,
);

export function ScheduledWorkspace() {
  const { environmentId, taskId, runId } = route.useSearch();
  const navigate = useNavigate({ from: "/scheduled" });
  const messages = useMessages();
  const gt = useGT();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { rows, sources, environmentCount, isReady } = useScheduledWorkspaceTasks();
  const row = rows.find((item) => item.environmentId === environmentId && item.task.id === taskId);
  const source = sources.find((item) => item.environment.environmentId === environmentId);
  const history = useEnvironmentQuery(
    row
      ? serverEnvironment.scheduledTaskRunsLive({
          environmentId: row.environmentId,
          input: { id: row.task.id },
        })
      : null,
    messages,
  );
  const runs = history.data?.runs ?? [];
  const latestRun = runs[0];
  // Without a runId the newest run is shown and the view follows new ones; a runId pins that run.
  const selectedRun = runId === undefined ? latestRun : runs.find((run) => run.runId === runId);
  const latestOnScreen = selectedRun !== undefined && selectedRun === latestRun;
  const taskKey = row ? scheduledTaskOrganizationKey(row.environmentId, row.task.id) : null;
  const lastRunAt = row?.task.lastRunAt ?? null;
  const lastRunStatus = row?.task.lastRunStatus ?? "never";
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editor, setEditor] = useState<{
    environmentId: EnvironmentId;
    task: ScheduledTask | null;
  } | null>(null);
  const connectedIds = sources.map(({ environment }) => environment.environmentId);
  const canCreate = useAtomValue(canCreateAtom(environmentIdsKey(connectedIds)));
  const creationIds = connectedIds.filter((_id, index) => canCreate[index]);
  const creationEnvironment =
    creationIds.find((id) => id === (row?.environmentId ?? primaryEnvironmentId)) ?? creationIds[0];

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- persists in client settings that the latest finished result is on screen
  useEffect(() => {
    if (taskKey === null || !latestOnScreen) return;
    const current = getClientSettings().scheduledTaskOrganization;
    const next = markScheduledTaskSeen(current, taskKey, { lastRunAt, lastRunStatus }, Date.now());
    if (next !== current) void persistClientSettingsPatch({ scheduledTaskOrganization: next });
  }, [taskKey, latestOnScreen, lastRunAt, lastRunStatus]);

  const selectRun = (run: ScheduledTaskRun) => {
    if (!row) return;
    void navigate({
      to: "/scheduled",
      search: {
        environmentId: row.environmentId,
        taskId: row.task.id,
        ...(run === latestRun ? {} : { runId: run.runId }),
      },
    });
  };
  const emptyMessage =
    !isReady || (source && source.data === null && source.error === null)
      ? gt("Loading scheduled tasks…")
      : taskId !== undefined
        ? (source?.error ?? gt("Task unavailable"))
        : sources.some(({ data, error }) => data === null && error === null)
          ? gt("Loading scheduled tasks…")
          : environmentCount > 0 && sources.length === 0
            ? gt("Connect an environment to manage scheduled tasks.")
            : rows.length > 0
              ? gt("Select a scheduled task")
              : gt("No scheduled tasks");
  const noRuns = history.data !== null && runs.length === 0;
  const runListProps: RunListProps = {
    runs,
    selected: selectedRun,
    loading: history.data === null,
    error: history.error,
    onRetry: history.refresh,
    onSelect: selectRun,
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <WorkspacePageHeader electron={isElectron}>
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
          <T>Scheduled</T>
        </h1>
        <Button
          className="[-webkit-app-region:no-drag]"
          size="sm"
          variant="ghost-muted"
          disabled={creationEnvironment === undefined}
          onClick={() =>
            creationEnvironment !== undefined &&
            setEditor({ environmentId: creationEnvironment, task: null })
          }
        >
          <PlusIcon className="size-4" />
          <T>New task</T>
        </Button>
      </WorkspacePageHeader>
      {row ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <TaskHeader
            environmentId={row.environmentId}
            task={row.task}
            timeZone={row.timeZone}
            environmentLabel={environmentCount > 1 && source ? source.environment.label : null}
            hasRuns={!noRuns}
            detailsOpen={detailsOpen}
            onToggleDetails={() => setDetailsOpen((open) => !open)}
            onEdit={() => setEditor(row)}
            onDeleted={() => void navigate({ to: "/scheduled", search: {} })}
          />
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <section className="flex min-h-0 min-w-0 flex-1 flex-col">
              <RunsDisclosure {...runListProps} />
              <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
                {selectedRun ? (
                  <ScheduledRunOutput
                    key={selectedRun.runId}
                    environmentId={row.environmentId}
                    task={row.task}
                    run={selectedRun}
                  />
                ) : noRuns || (history.error !== null && runId === undefined) ? (
                  <div className="mx-auto max-w-3xl px-5 py-5">
                    <TaskInstructions task={row.task} />
                  </div>
                ) : (
                  <p role="status" className="px-5 py-6 text-sm text-muted-foreground">
                    {history.error ??
                      (history.data === null ? gt("Loading runs…") : gt("This run is unavailable"))}
                  </p>
                )}
              </div>
            </section>
            <aside
              aria-label={gt("Runs")}
              className="hidden min-h-0 flex-col lg:flex lg:w-72 lg:shrink-0 lg:border-l xl:w-80"
            >
              <h2 className="px-4 pt-4 pb-2 text-sm font-semibold">
                <T>Runs</T>
              </h2>
              <RunList {...runListProps} />
            </aside>
          </div>
        </div>
      ) : (
        <div
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground"
          role="status"
        >
          <CalendarClockIcon aria-hidden className="size-5" />
          {emptyMessage}
        </div>
      )}
      {editor ? (
        <Suspense fallback={null}>
          <ScheduledTaskEditor
            key={JSON.stringify([editor.environmentId, editor.task?.id])}
            initialEnvironmentId={editor.environmentId}
            task={editor.task}
            onClose={() => setEditor(null)}
          />
        </Suspense>
      ) : null}
    </SidebarInset>
  );
}
