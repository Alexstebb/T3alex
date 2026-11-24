import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ScheduledTask } from "@t3tools/contracts";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { T, useGT, useMessages } from "gt-react";
import { CalendarClockIcon, PlusIcon } from "lucide-react";
import { Suspense, useEffect, useState } from "react";

import { isElectron } from "../../env";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { environmentAtomList, environmentIdsKey } from "../../state/environmentAtomList";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { ScheduledRunList } from "./ScheduledRunList";
import { openScheduledRun } from "./scheduledRunSelection";
import { ScheduledTaskHeader, ScheduledTaskInstructions } from "./ScheduledTaskHeader";
import { ScheduledTaskEditor } from "./scheduledTaskActions";
import { useScheduledWorkspaceTasks } from "./useScheduledWorkspaceTasks";

const route = getRouteApi("/_chat/scheduled");

const canCreateAtom = environmentAtomList(
  "web-scheduled-workspace-permissions",
  serverEnvironment.upsertScheduledTask.permissionAtom,
);

/** The task page for a task without runs; a task with runs opens its latest run's chat. */
export function ScheduledWorkspace() {
  const { environmentId, taskId } = route.useSearch();
  const navigate = useNavigate();
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
  const [editor, setEditor] = useState<{
    environmentId: EnvironmentId;
    task: ScheduledTask | null;
  } | null>(null);
  const connectedIds = sources.map(({ environment }) => environment.environmentId);
  const canCreate = useAtomValue(canCreateAtom(environmentIdsKey(connectedIds)));
  const creationIds = connectedIds.filter((_id, index) => canCreate[index]);
  const creationEnvironment =
    creationIds.find((id) => id === (row?.environmentId ?? primaryEnvironmentId)) ?? creationIds[0];

  const redirectEnvironmentId = row?.environmentId;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves the router to the latest run's chat once the task's runs have loaded
  useEffect(() => {
    if (redirectEnvironmentId === undefined || latestRun === undefined) return;
    void openScheduledRun(navigate, redirectEnvironmentId, latestRun, runs, { replace: true });
  }, [navigate, redirectEnvironmentId, latestRun, runs]);

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
      {row && (noRuns || history.error !== null) ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <ScheduledTaskHeader
            environmentId={row.environmentId}
            task={row.task}
            timeZone={row.timeZone}
            environmentLabel={environmentCount > 1 && source ? source.environment.label : null}
            detailsToggle={false}
            onEdit={() => setEditor(row)}
            onDeleted={() => void navigate({ to: "/scheduled", search: {} })}
          />
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <section className="scrollbar-gutter-both min-h-0 min-w-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-3xl px-5 py-5">
                <ScheduledTaskInstructions task={row.task} />
              </div>
            </section>
            <aside
              aria-label={gt("Runs")}
              className="hidden min-h-0 flex-col lg:flex lg:w-72 lg:shrink-0 lg:border-l xl:w-80"
            >
              <h2 className="px-4 pt-4 pb-2 text-sm font-semibold">
                <T>Runs</T>
              </h2>
              <ScheduledRunList
                runs={runs}
                selected={undefined}
                loading={false}
                error={history.error}
                onRetry={history.refresh}
                onSelect={() => undefined}
              />
            </aside>
          </div>
        </div>
      ) : (
        <div
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground"
          role="status"
        >
          <CalendarClockIcon aria-hidden className="size-5" />
          {row ? gt("Loading runs…") : emptyMessage}
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
