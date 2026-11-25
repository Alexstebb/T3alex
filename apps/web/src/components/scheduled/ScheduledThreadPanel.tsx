import { RegistryContext } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { ScheduledTaskRun, ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate, useRouter } from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { T, useGT } from "gt-react";
import { CalendarClockIcon, PanelRightCloseIcon } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  Suspense,
  useContext,
  useEffect,
  useState,
} from "react";

import { isElectron } from "../../env";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { getClientSettings, persistClientSettingsPatch } from "../../hooks/useSettings";
import { assistantCitationNavigation } from "../../lib/assistantCitationNavigation";
import { cn } from "../../lib/utils";
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

// Copies the window's insets before the inner wrapper redefines them; a property cannot read its
// own inherited value.
const WINDOW_INSETS_STYLE = {
  "--scheduled-window-controls-right": "var(--workspace-controls-right)",
  "--scheduled-window-native-inset": "var(--workspace-native-controls-inset)",
} as CSSProperties;
// The chat's panel toggles are fixed to the window's top-right corner and its headers pad for the
// native window controls (`.wco`). Beside the panel both move off it, as if the window ended at
// the panel's left edge. The native controls still cover part of the chat beside the rail.
const CHAT_INSETS_STYLE = {
  "--workspace-controls-right":
    "max(var(--scheduled-window-controls-right), calc(var(--scheduled-runs-width) + env(safe-area-inset-right) + 0.75rem))",
  "--workspace-native-controls-inset":
    "max(calc(var(--scheduled-window-native-inset) - var(--scheduled-runs-width)), 0.75rem)",
} as CSSProperties;
// The rail below `lg` or while the panel is hidden, else the panel.
const RUNS_WIDTH_RAIL = "[--scheduled-runs-width:2.5rem]";
const RUNS_WIDTH_OPEN =
  "[--scheduled-runs-width:2.5rem] lg:[--scheduled-runs-width:18rem] xl:[--scheduled-runs-width:20rem]";

/**
 * The `_chat` layout's thread view and, for a scheduled task's run, the task, its actions and its
 * runs beside it, so the chat itself stays the normal thread route. The wrappers are always
 * rendered so the chat keeps its place in the tree when the task is found or the thread changes.
 * Below the `lg` breakpoint the panel is a rail whose Runs button opens the list in a sheet.
 */
export function ScheduledThreadFrame({
  threadRef,
  children,
}: {
  readonly threadRef: ScopedThreadRef | null;
  readonly children: ReactNode;
}) {
  const task = useScheduledThreadTask(threadRef);
  const [open, setOpen] = useLocalStorage(SCHEDULED_RUNS_PANEL_OPEN_KEY, true, Schema.Boolean);
  const shown = threadRef !== null && task.row !== undefined;
  return (
    <div
      className={cn("contents", shown && (open ? RUNS_WIDTH_OPEN : RUNS_WIDTH_RAIL))}
      style={WINDOW_INSETS_STYLE}
    >
      <div className="contents" style={shown ? CHAT_INSETS_STYLE : undefined}>
        {children}
      </div>
      {shown ? (
        <ScheduledThreadPanel
          threadRef={threadRef}
          task={task}
          open={open}
          onOpenChange={setOpen}
        />
      ) : null}
    </div>
  );
}

function ScheduledThreadPanel({
  threadRef,
  task: { row, runs, lookup, environmentLabel },
  open,
  onOpenChange: setOpen,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly task: ReturnType<typeof useScheduledThreadTask>;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const threadKey = scopedThreadKey(threadRef);
  const pickedRunId = useScheduledRunSelection((state) => state.pickedRunByThread[threadKey]);
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
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        {/* Below the title bar, which keeps the chat's panel toggles and the native window controls. */}
        <SheetPopup
          side="right"
          className="mt-(--workspace-topbar-height) h-[calc(100%-var(--workspace-topbar-height))] max-h-[calc(100%-var(--workspace-topbar-height))] w-[min(88vw,22rem)] lg:hidden"
        >
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
          className="hidden h-dvh min-h-0 w-(--scheduled-runs-width) shrink-0 flex-col border-l bg-background lg:flex"
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
          </div>
          {body()}
        </aside>
      ) : null}
      <div
        className={cn(
          "flex h-dvh w-(--scheduled-runs-width) shrink-0 flex-col items-center border-l bg-background",
          open && "lg:hidden",
        )}
        data-scheduled-runs-rail
      >
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
                className="lg:hidden"
                aria-label={gt("Runs")}
                onClick={() => setSheetOpen(true)}
              />
            }
          >
            <CalendarClockIcon aria-hidden />
          </TooltipTrigger>
          <TooltipPopup side="left">{gt("Runs")}</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost-muted"
                className="max-lg:hidden"
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
