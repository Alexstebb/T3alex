import { RegistryContext } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { ScheduledTaskRun, ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate, useRouter } from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { T, useGT } from "gt-react";
import { CalendarClockIcon, PanelRightCloseIcon } from "lucide-react";
import { Suspense, useContext, useEffect, useState } from "react";

import { isElectron } from "../../env";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { getClientSettings, persistClientSettingsPatch } from "../../hooks/useSettings";
import { assistantCitationNavigation } from "../../lib/assistantCitationNavigation";
import { cn } from "../../lib/utils";
import { selectThreadRightPanelState, useRightPanelStore } from "../../rightPanelStore";
import { threadEnvironment, useEnvironmentThread } from "../../state/threads";
import { Button } from "../ui/button";
import { Sheet, SheetHeader, SheetPopup, SheetTitle } from "../ui/sheet";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ScheduledRunList } from "./ScheduledRunList";
import {
  clearPendingRunReveal,
  openScheduledRun,
  scheduledRunRevealCitation,
  selectedScheduledRun,
  useScheduledRunSelection,
} from "./scheduledRunSelection";
import { ScheduledTaskHeader } from "./ScheduledTaskHeader";
import { ScheduledTaskEditor } from "./scheduledTaskActions";
import { markScheduledTaskSeen, scheduledTaskOrganizationKey } from "./scheduledTaskOrganization";
import { useScheduledThreadTask } from "./useScheduledThreadTask";

export const SCHEDULED_RUNS_PANEL_OPEN_KEY = "t3code:scheduled-runs-panel:open";

/**
 * Scrolls to a shared-thread run's reply through the chat's own quote reveal, after paging the
 * reply into the loaded history if needed.
 */
function usePendingRunReveal(threadRef: ScopedThreadRef, runs: readonly ScheduledTaskRun[]) {
  const threadKey = scopedThreadKey(threadRef);
  const pendingRunId = useScheduledRunSelection((state) =>
    state.pendingReveal?.threadKey === threadKey ? state.pendingReveal.runId : null,
  );
  const run = runs.find((candidate) => candidate.runId === pendingRunId);
  const state = useEnvironmentThread(
    run ? threadRef.environmentId : null,
    run ? threadRef.threadId : null,
  );
  const registry = useContext(RegistryContext);
  const router = useRouter();
  const thread = Option.getOrNull(state.data);
  const replyId = run?.assistantMessageId ?? null;
  const reply =
    replyId === null ? undefined : thread?.messages.find((message) => message.id === replyId);
  const replyText = reply?.text ?? "";
  const settled = thread !== null && !state.history.loading;
  const canPage = settled && reply === undefined && state.history.hasMoreHistory;
  const giveUp =
    run !== undefined &&
    (replyId === null ||
      state.history.error !== null ||
      (settled && reply === undefined && !state.history.hasMoreHistory));

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- requests the history page holding the run's reply when bounded chat history omitted it
  useEffect(() => {
    if (!canPage || replyId === null) return;
    void runAtomCommand(
      registry,
      threadEnvironment.loadEarlierHistory,
      {
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, throughEntryId: replyId },
      },
      { label: "load scheduled run reply", reportFailure: false },
    );
  }, [canPage, registry, replyId, threadRef.environmentId, threadRef.threadId]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves the router to the reply's quote reveal once the reply is loaded, or drops the request when it cannot be
  useEffect(() => {
    if (giveUp) {
      clearPendingRunReveal(threadKey);
      return;
    }
    if (replyId === null || replyText === "") return;
    clearPendingRunReveal(threadKey);
    const citation = scheduledRunRevealCitation({
      environmentId: threadRef.environmentId,
      threadId: threadRef.threadId,
      messageId: replyId,
      text: replyText,
    });
    if (citation !== null) {
      void router.navigate({ ...assistantCitationNavigation(citation, null), replace: true });
    }
  }, [giveUp, replyId, replyText, router, threadKey, threadRef.environmentId, threadRef.threadId]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a reveal meant for this thread is dropped when the chat moves to another thread
  useEffect(() => () => clearPendingRunReveal(threadKey), [threadKey]);
}

/**
 * Beside the chat of a scheduled task's run: the task, its actions and its runs. Rendered by the
 * `_chat` layout next to the thread view, so the chat itself stays the normal thread route. Below
 * the `lg` breakpoint the panel has no room, so a "Runs" button opens the same list in a sheet.
 */
export function ScheduledThreadPanel({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const gt = useGT();
  const navigate = useNavigate();
  const { row, runs, lookup, environmentLabel } = useScheduledThreadTask(threadRef);
  const [open, setOpen] = useLocalStorage(SCHEDULED_RUNS_PANEL_OPEN_KEY, true, Schema.Boolean);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const threadKey = scopedThreadKey(threadRef);
  const pickedRunId = useScheduledRunSelection((state) => state.pickedRunByThread[threadKey]);
  const chatPanelOpen = useRightPanelStore(
    (state) => selectThreadRightPanelState(state.byThreadKey, threadRef).isOpen,
  );
  usePendingRunReveal(threadRef, runs);

  const taskKey = row ? scheduledTaskOrganizationKey(row.environmentId, row.task.id) : null;
  const latestOnScreen = runs[0]?.threadId === threadRef.threadId;
  const lastRunAt = row?.task.lastRunAt ?? null;
  const lastRunStatus = row?.task.lastRunStatus ?? "never";
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- persists in client settings that the latest run's chat, and so its result, is on screen
  useEffect(() => {
    if (taskKey === null || !latestOnScreen) return;
    const current = getClientSettings().scheduledTaskOrganization;
    const next = markScheduledTaskSeen(current, taskKey, { lastRunAt, lastRunStatus }, Date.now());
    if (next !== current) void persistClientSettingsPatch({ scheduledTaskOrganization: next });
  }, [taskKey, latestOnScreen, lastRunAt, lastRunStatus]);

  if (row === undefined) return null;

  const body = (onPicked?: () => void) => (
    <>
      <ScheduledTaskHeader
        key={taskKey}
        environmentId={row.environmentId}
        task={row.task}
        timeZone={row.timeZone}
        environmentLabel={environmentLabel}
        detailsToggle
        onEdit={() => setEditing(true)}
        onDeleted={() => undefined}
      />
      <h3 className="px-4 pt-3 pb-2 text-sm font-semibold">
        <T>Runs</T>
      </h3>
      <ScheduledRunList
        runs={runs}
        selected={selectedScheduledRun(runs, threadRef.threadId, pickedRunId)}
        loading={lookup.data === null}
        error={lookup.error}
        onRetry={lookup.refresh}
        onSelect={(run) => {
          onPicked?.();
          void openScheduledRun(navigate, row.environmentId, run, runs);
        }}
      />
    </>
  );

  return (
    <>
      <Button
        size="xs"
        variant="outline"
        className="fixed top-[calc(var(--workspace-topbar-height)+--spacing(2))] right-3 z-20 lg:hidden"
        onClick={() => setSheetOpen(true)}
      >
        <CalendarClockIcon aria-hidden />
        <T>Runs</T>
      </Button>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetPopup side="right" className="w-[min(88vw,22rem)] lg:hidden">
          <SheetHeader className="sr-only">
            <SheetTitle>
              <T>Runs</T>
            </SheetTitle>
          </SheetHeader>
          <div className="flex h-12 shrink-0 items-center gap-1.5 pr-12 pl-4 text-xs font-medium text-muted-foreground">
            <CalendarClockIcon aria-hidden className="size-3.5 shrink-0" />
            <T>Scheduled</T>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">{body(() => setSheetOpen(false))}</div>
        </SheetPopup>
      </Sheet>
      {open ? (
        <aside
          aria-label={gt("Runs")}
          className="hidden h-dvh min-h-0 w-72 shrink-0 flex-col border-l bg-background lg:flex xl:w-80"
        >
          <div
            className={cn(
              "flex h-[var(--workspace-topbar-height)] shrink-0 items-center gap-1.5 pr-3 pl-2 wco:pr-(--workspace-native-controls-inset)",
              isElectron && "drag-region",
            )}
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    className="[-webkit-app-region:no-drag]"
                    aria-label={gt("Hide runs")}
                    onClick={() => setOpen(false)}
                  />
                }
              >
                <PanelRightCloseIcon aria-hidden />
              </TooltipTrigger>
              <TooltipPopup side="bottom">{gt("Hide runs")}</TooltipPopup>
            </Tooltip>
            <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <CalendarClockIcon aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">
                <T>Scheduled</T>
              </span>
            </span>
            {/* The chat's panel controls float over this corner while its own right panel is open. */}
            {chatPanelOpen ? <span aria-hidden className="ml-auto w-28 shrink-0" /> : null}
          </div>
          {body()}
        </aside>
      ) : (
        <div className="hidden h-dvh w-10 shrink-0 flex-col items-center border-l bg-background lg:flex">
          <div
            className={cn(
              "h-[var(--workspace-topbar-height)] w-full shrink-0",
              isElectron && "drag-region",
            )}
          />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost-muted"
                  aria-label={gt("Show runs")}
                  onClick={() => setOpen(true)}
                />
              }
            >
              <CalendarClockIcon aria-hidden />
            </TooltipTrigger>
            <TooltipPopup side="left">{gt("Show runs")}</TooltipPopup>
          </Tooltip>
        </div>
      )}
      {editing ? (
        <Suspense fallback={null}>
          <ScheduledTaskEditor
            key={JSON.stringify([row.environmentId, row.task.id])}
            initialEnvironmentId={row.environmentId}
            task={row.task}
            onClose={() => setEditing(false)}
          />
        </Suspense>
      ) : null}
    </>
  );
}
