import type { ClientSettings } from "@t3tools/contracts";
import { Link, useLocation } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { T, useGT } from "gt-react";
import { ArrowUpRightIcon, CalendarClockIcon, ChevronDownIcon, PlusIcon } from "lucide-react";
import { memo, useId, useState } from "react";

import { useLocalStorage, writeLocalStorageValue } from "../../hooks/useLocalStorage";
import { useClientSettings } from "../../hooks/useSettings";
import { useThreadRouteRef } from "../../hooks/useThreadRouteTarget";
import { cn } from "../../lib/utils";
import { isScheduledWorkspacePath } from "../sidebar/mainAppLocation";
import { SidebarSectionLamp } from "../sidebar/SidebarSectionLamp";
import { Button } from "../ui/button";
import { useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ScheduledTaskNavigation, useScheduledHeaderLamp } from "./ScheduledTaskNavigation";
import { scheduledTaskOrganizationKey } from "./scheduledTaskOrganization";
import { validateScheduledWorkspaceSearch } from "./scheduledWorkspaceSearch";
import { useScheduledThreadTask } from "./useScheduledThreadTask";
import { useScheduledWorkspaceTasks } from "./useScheduledWorkspaceTasks";

export const SCHEDULED_SIDEBAR_COLLAPSED_KEY = "t3code:scheduled-sidebar:collapsed";

export function expandScheduledSidebar() {
  writeLocalStorageValue(SCHEDULED_SIDEBAR_COLLAPSED_KEY, false, true, Schema.Boolean);
}

const selectOrganization = (settings: ClientSettings) => settings.scheduledTaskOrganization;

export const ScheduledSidebarGroup = memo(function ScheduledSidebarGroup() {
  const gt = useGT();
  const contentId = useId();
  const [collapsed, setCollapsed] = useLocalStorage(
    SCHEDULED_SIDEBAR_COLLAPSED_KEY,
    true,
    Schema.Boolean,
  );
  const [creatingSection, setCreatingSection] = useState(false);
  const { isMobile, setOpenMobile } = useSidebar();
  const { rows, sources, isReady } = useScheduledWorkspaceTasks();
  const organization = useClientSettings(selectOrganization);
  const selectedKey = useSelectedScheduledTaskKey();
  const loading = !isReady || sources.some(({ data, error }) => data === null && error === null);
  // Pinned tasks stay listed while collapsed, so only the hidden ones light the header.
  const hiddenRows = rows.filter(
    (row) =>
      !organization.pinnedTaskKeys.includes(
        scheduledTaskOrganizationKey(row.environmentId, row.task.id),
      ),
  );
  const headerLamp = useScheduledHeaderLamp(hiddenRows, collapsed);
  const closeMobileSidebar = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <section className="mb-2">
      <div className="flex items-center gap-1 rounded-(--control-radius) hover:bg-sidebar-row-hover">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={contentId}
          onClick={() => {
            setCreatingSection(false);
            setCollapsed((current) => !current);
          }}
          className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-(--control-radius) px-(--sidebar-row-content-inset) text-left text-sidebar-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <CalendarClockIcon
            aria-hidden
            className="size-3.5 shrink-0 text-sidebar-muted-foreground"
          />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            <T>Scheduled</T>
          </span>
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "size-3 shrink-0 text-sidebar-muted-foreground transition-transform",
              collapsed && "-rotate-90",
            )}
          />
        </button>
        {headerLamp ? (
          <span className="mr-1 flex">
            <SidebarSectionLamp
              lamp={headerLamp.lamp}
              entries={headerLamp.entries}
              onMarkAllRead={headerLamp.onMarkAllRead}
              onResumeAll={headerLamp.onResumeAll}
            />
          </span>
        ) : null}
        {!collapsed ? (
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label={gt("New subsection")}
                    onClick={() => setCreatingSection(true)}
                  />
                }
              >
                <PlusIcon aria-hidden />
              </TooltipTrigger>
              <TooltipPopup>{gt("New subsection")}</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label={gt("Open Scheduled")}
                    render={
                      <Link
                        to="/scheduled"
                        preload="intent"
                        onClick={() => {
                          if (isMobile) setOpenMobile(false);
                        }}
                      />
                    }
                  />
                }
              >
                <ArrowUpRightIcon aria-hidden />
              </TooltipTrigger>
              <TooltipPopup>{gt("Open Scheduled")}</TooltipPopup>
            </Tooltip>
          </>
        ) : null}
      </div>
      {collapsed ? (
        <ScheduledTaskNavigation
          rows={rows}
          selectedKey={selectedKey}
          pinnedOnly
          creatingSection={false}
          onCloseCreateSection={() => undefined}
          loading={loading}
          onSelect={closeMobileSidebar}
        />
      ) : null}
      <div id={contentId} hidden={collapsed}>
        {collapsed ? null : (
          <>
            <ScheduledTaskNavigation
              rows={rows}
              selectedKey={selectedKey}
              creatingSection={creatingSection}
              onCloseCreateSection={() => setCreatingSection(false)}
              loading={loading}
              onSelect={closeMobileSidebar}
            />
            {sources.map(({ environment, error }) =>
              error === null ? null : (
                <p
                  key={environment.environmentId}
                  role="status"
                  className="px-3 py-2 text-xs text-destructive"
                >
                  {environment.label} · {error}
                </p>
              ),
            )}
          </>
        )}
      </div>
    </section>
  );
});

/** The task page's task, or the task whose run the open chat belongs to. */
function useSelectedScheduledTaskKey() {
  const pageKey = useLocation({
    select: (location) => {
      if (!isScheduledWorkspacePath(location.pathname)) return null;
      const { environmentId, taskId } = validateScheduledWorkspaceSearch(location.search);
      return environmentId !== undefined && taskId !== undefined
        ? scheduledTaskOrganizationKey(environmentId, taskId)
        : null;
    },
  });
  const { row } = useScheduledThreadTask(useThreadRouteRef());
  return pageKey ?? (row ? scheduledTaskOrganizationKey(row.environmentId, row.task.id) : null);
}
