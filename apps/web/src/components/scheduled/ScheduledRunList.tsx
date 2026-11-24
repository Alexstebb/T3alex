import type { ScheduledTaskRun } from "@t3tools/contracts";
import { msg, T, useLocale, useMessages } from "gt-react";
import { ChevronRightIcon } from "lucide-react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { useClientSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { formatScheduledRunTime } from "./scheduledRunLabel";

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

export function ScheduledRunList(props: {
  readonly runs: readonly ScheduledTaskRun[];
  readonly selected: ScheduledTaskRun | undefined;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onSelect: (run: ScheduledTaskRun) => void;
  readonly onRetry: () => void;
}) {
  const { runs, selected, error } = props;
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
          <Button variant="ghost" size="xs" onClick={props.onRetry}>
            <T>Retry</T>
          </Button>
        </div>
      ) : null}
      {runs.length === 0 && error === null ? (
        <p role="status" className="px-2 py-1.5 text-xs text-muted-foreground">
          {props.loading ? <T>Loading runs…</T> : <T>No runs yet</T>}
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
              onClick={() => props.onSelect(run)}
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
