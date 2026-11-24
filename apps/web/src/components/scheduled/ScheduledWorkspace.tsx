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
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
} from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { isElectron } from "../../env";
import { useClientSettings } from "../../hooks/useSettings";
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
import { scheduledTaskState } from "./scheduledTaskOrganization";
import { useScheduledWorkspaceTasks } from "./useScheduledWorkspaceTasks";

const route = getRouteApi("/_chat/scheduled");
const ScheduledTaskEditor = lazy(async () => {
  const { StandaloneScheduledTaskEditorDialog } =
    await import("../settings/ScheduledTasksSettings");
  return { default: StandaloneScheduledTaskEditorDialog };
});

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

function RunList({
  runs,
  selected,
  loading,
  error,
  onSelect,
  onRetry,
}: {
  readonly runs: readonly ScheduledTaskRun[];
  readonly selected: ScheduledTaskRun | undefined;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onSelect: (run: ScheduledTaskRun) => void;
  readonly onRetry: () => void;
}) {
  const messages = useMessages();
  const locale = useLocale();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const nowMs = Date.parse(useNowMinute());
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
                  {formatScheduledRunTime(run.requestedAt, nowMs, timestampFormat, locale)}
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

const canCreateAtom = environmentAtomList(
  "web-scheduled-workspace-permissions",
  serverEnvironment.upsertScheduledTask.permissionAtom,
);

export function ScheduledWorkspace() {
  const { environmentId, taskId, runId } = route.useSearch();
  const navigate = useNavigate({ from: "/scheduled" });
  const messages = useMessages();
  const locale = useLocale();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const gt = useGT();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { rows, sources, environmentCount, isReady } = useScheduledWorkspaceTasks();
  const row = rows.find((item) => item.environmentId === environmentId && item.task.id === taskId);
  const source = sources.find((item) => item.environment.environmentId === environmentId);
  const project = useProject(row ? scopeProjectRef(row.environmentId, row.task.projectId) : null);
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
  const selectedRun = runs.find((run) => run.runId === runId);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editor, setEditor] = useState<{
    environmentId: EnvironmentId;
    task: ScheduledTask | null;
  } | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<ScheduledTask["id"] | null>(null);
  const connectedIds = sources.map(({ environment }) => environment.environmentId);
  const canCreate = useAtomValue(canCreateAtom(environmentIdsKey(connectedIds)));
  const creationIds = connectedIds.filter((_id, index) => canCreate[index]);
  const creationEnvironment =
    creationIds.find((id) => id === (row?.environmentId ?? primaryEnvironmentId)) ?? creationIds[0];
  const canEdit = row !== undefined && creationIds.includes(row.environmentId);
  const completedOnce = row !== undefined && isCompletedOneTimeScheduledTask(row.task);
  const runTask = useAtomCommand(serverEnvironment.runScheduledTaskNow, { reportFailure: false });
  const runNow = async () => {
    if (!row || pendingTaskId === row.task.id) return;
    setPendingTaskId(row.task.id);
    const result = await runTask({ environmentId: row.environmentId, input: { id: row.task.id } });
    setPendingTaskId((id) => (id === row.task.id ? null : id));
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
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {runId !== undefined ? (
            <section className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="border-b px-3 py-2 lg:hidden">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void navigate({
                      to: "/scheduled",
                      search: { environmentId: row.environmentId, taskId: row.task.id },
                    })
                  }
                >
                  <ChevronLeftIcon className="size-3.5" />
                  <T>Back to runs</T>
                </Button>
              </div>
              <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
                {selectedRun ? (
                  <ScheduledRunOutput
                    key={selectedRun.runId}
                    environmentId={row.environmentId}
                    task={row.task}
                    run={selectedRun}
                  />
                ) : (
                  <p role="status" className="px-5 py-6 text-sm text-muted-foreground">
                    {history.error ??
                      (history.data === null ? gt("Loading runs…") : gt("This run is unavailable"))}
                  </p>
                )}
              </div>
            </section>
          ) : null}
          <aside
            aria-label={gt("Runs")}
            className={cn(
              "min-h-0 flex-col",
              runId === undefined
                ? "flex flex-1"
                : "hidden lg:flex lg:w-80 lg:shrink-0 lg:border-l xl:w-96",
            )}
          >
            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col",
                runId === undefined && "mx-auto w-full max-w-2xl",
              )}
            >
              <div className="space-y-2 px-4 pt-4 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="min-w-0 text-base font-semibold wrap-break-word">
                    {row.task.title}
                  </h2>
                  <Button
                    size="xs"
                    variant="ghost-muted"
                    aria-expanded={detailsOpen}
                    onClick={() => setDetailsOpen((open) => !open)}
                  >
                    <T>Details</T>
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  {project ? <span>{project.title} ·</span> : null}
                  {environmentCount > 1 && source ? (
                    <span>{source.environment.label} ·</span>
                  ) : null}
                  <span>
                    {scheduleLabel(
                      row.task.schedule,
                      timestampFormat,
                      row.timeZone,
                      row.task.nextRunAt,
                      messages,
                      locale,
                    )}
                  </span>
                  {!row.task.enabled ? (
                    <Badge variant="outline">
                      {completedOnce
                        ? gt("Completed")
                        : scheduledTaskState(row.task) === "not_started"
                          ? gt("Not started")
                          : gt("Paused")}
                    </Badge>
                  ) : null}
                </div>
                {canEdit ? (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditor(row)}>
                      <PencilIcon className="size-3.5" />
                      <T>Edit</T>
                    </Button>
                    {row.task.schedule.type !== "webhook" && !completedOnce ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          pendingTaskId === row.task.id || row.task.lastRunStatus === "running"
                        }
                        onClick={() => void runNow()}
                      >
                        <PlayIcon className="size-3.5" />
                        <T>Run now</T>
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {detailsOpen ? (
                  <div className="space-y-2 rounded-lg bg-muted/40 px-3 py-2.5 text-sm">
                    <p className="whitespace-pre-wrap wrap-break-word text-muted-foreground">
                      {row.task.prompt}
                    </p>
                    {row.task.lastRunError ? (
                      <p className="text-destructive">{row.task.lastRunError}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <RunList
                runs={runs}
                selected={selectedRun}
                loading={history.data === null}
                error={history.error}
                onRetry={history.refresh}
                onSelect={(run) =>
                  void navigate({
                    to: "/scheduled",
                    search: {
                      environmentId: row.environmentId,
                      taskId: row.task.id,
                      runId: run.runId,
                    },
                  })
                }
              />
            </div>
          </aside>
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
