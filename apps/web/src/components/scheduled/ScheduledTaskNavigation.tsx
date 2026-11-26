import { Link, useRouter } from "@tanstack/react-router";
import { useGT, useLocale } from "gt-react";
import {
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  EllipsisIcon,
  LayersIcon,
  MailCheckIcon,
  MailIcon,
  PauseIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlayIcon,
  Trash2Icon,
} from "lucide-react";
import { Suspense, useEffect, useId, useRef, useState } from "react";

import type {
  ClientSettings,
  EnvironmentId,
  ScheduledTask,
  ScheduledTaskGroupId,
} from "@t3tools/contracts";

import { getLocalStorageItem, removeLocalStorageItem } from "../../hooks/useLocalStorage";
import { useNowMinute } from "../../hooks/useNowMinute";
import {
  getClientSettings,
  persistClientSettingsPatch,
  persistClientSettingsUpdate,
  useClientSettings,
  useClientSettingsHydrated,
} from "../../hooks/useSettings";
import { cn, randomUUID } from "../../lib/utils";
import { isScheduledWorkspacePath } from "../sidebar/mainAppLocation";
import { SidebarSectionLamp } from "../sidebar/SidebarSectionLamp";
import {
  countSectionLampTones,
  resolveSectionLamp,
  type SectionLamp,
} from "../sidebar/sidebarSectionLamp.logic";
import { Button } from "../ui/button";
import { Dialog, DialogClose, DialogFooter, DialogPopup, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import {
  ScheduledTaskDeleteDialog,
  ScheduledTaskEditor,
  useScheduledTaskActions,
} from "./scheduledTaskActions";
import {
  automaticScheduledGroup,
  hasFinishedScheduledRun,
  indexScheduledTaskSections,
  isScheduledTaskUnread,
  markScheduledTaskSeen,
  markScheduledTaskUnseen,
  moveScheduledTaskToSection,
  removeScheduledTaskSection,
  ScheduledTaskOrganization,
  scheduledTaskLampTone,
  scheduledTaskOrganizationKey,
  scheduledTaskState,
  toggleScheduledTaskGroup,
  toggleScheduledTaskPin,
  type ScheduledTaskSection,
} from "./scheduledTaskOrganization";

interface ScheduledTaskNavigationRow {
  readonly environmentId: EnvironmentId;
  readonly task: ScheduledTask;
}

const LEGACY_STORAGE_KEY = "t3code:scheduled-task-organization";

const selectOrganization = (settings: ClientSettings) => settings.scheduledTaskOrganization;

let legacyOrganizationImported = false;

// Older builds kept this in browser storage, which is lost with the Electron profile.
function importLegacyOrganization() {
  if (legacyOrganizationImported) return;
  legacyOrganizationImported = true;
  let legacy: ScheduledTaskOrganization | null = null;
  try {
    legacy = getLocalStorageItem(LEGACY_STORAGE_KEY, ScheduledTaskOrganization);
  } catch {
    return;
  }
  if (legacy === null) return;
  const toImport = legacy;
  void persistClientSettingsUpdate((current) => {
    const existing = current.scheduledTaskOrganization;
    return existing.sections.length > 0 || existing.pinnedTaskKeys.length > 0
      ? current
      : { ...current, scheduledTaskOrganization: toImport };
  }).then(() => {
    try {
      removeLocalStorageItem(LEGACY_STORAGE_KEY);
    } catch {
      // The import is idempotent, so a leftover key is harmless.
    }
  });
}

function useScheduledTaskOrganization() {
  const organization = useClientSettings(selectOrganization);
  const hydrated = useClientSettingsHydrated();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- one-time import of organization saved by older builds in browser storage
  useEffect(() => {
    if (hydrated) importLegacyOrganization();
  }, [hydrated]);
  const setOrganization = (
    update: (current: ScheduledTaskOrganization) => ScheduledTaskOrganization,
  ) => {
    void persistClientSettingsPatch({
      scheduledTaskOrganization: update(getClientSettings().scheduledTaskOrganization),
    });
  };
  return [organization, setOrganization] as const;
}

function runAtMs(task: ScheduledTask) {
  return task.schedule.type === "once" ? Date.parse(task.schedule.runAt) : Number.POSITIVE_INFINITY;
}

export function ScheduledTaskNavigation(props: {
  readonly rows: readonly ScheduledTaskNavigationRow[];
  readonly selectedKey: string | null;
  /** Only the pinned tasks, without their heading, for the collapsed Scheduled group. */
  readonly pinnedOnly?: boolean;
  readonly creatingSection: boolean;
  readonly onCloseCreateSection: () => void;
  readonly onSelect: () => void;
  readonly loading: boolean;
}) {
  const gt = useGT();
  const [organization, setOrganization] = useScheduledTaskOrganization();
  const nowMinute = useNowMinute();
  const [renamingSection, setRenamingSection] = useState<ScheduledTaskSection>();
  const nameDialog = props.creatingSection ? null : renamingSection;
  const closeNameDialog = () => {
    props.onCloseCreateSection();
    setRenamingSection(undefined);
  };
  const rowsByKey = new Map(
    props.rows.map((row) => [scheduledTaskOrganizationKey(row.environmentId, row.task.id), row]),
  );
  const pinnedKeys = new Set(organization.pinnedTaskKeys);
  const pinnedRows = organization.pinnedTaskKeys.flatMap((key) => {
    const row = rowsByKey.get(key);
    return row === undefined ? [] : [{ key, row }];
  });
  const sectionIdsByTask = indexScheduledTaskSections(organization);
  const now = Date.parse(nowMinute);
  const automatic = {
    upcoming: [] as { key: string; row: ScheduledTaskNavigationRow }[],
    all: [] as { key: string; row: ScheduledTaskNavigationRow }[],
    completed: [] as { key: string; row: ScheduledTaskNavigationRow }[],
  };
  for (const [key, row] of rowsByKey) {
    if (pinnedKeys.has(key) || sectionIdsByTask.has(key)) continue;
    const group = automaticScheduledGroup(row.task, now);
    if (group !== "hidden") automatic[group].push({ key, row });
  }
  automatic.upcoming.sort((a, b) => runAtMs(a.row.task) - runAtMs(b.row.task));
  automatic.completed.sort((a, b) => runAtMs(b.row.task) - runAtMs(a.row.task));

  const saveSectionName = (name: string) => {
    setOrganization((current) =>
      nameDialog === null
        ? {
            ...current,
            sections: [
              ...current.sections,
              { id: randomUUID(), name, collapsed: false, taskKeys: [] },
            ],
          }
        : {
            ...current,
            sections: current.sections.map((section) =>
              section.id === nameDialog?.id ? { ...section, name } : section,
            ),
          },
    );
    closeNameDialog();
  };

  const lampOf = (entries: readonly { key: string; row: ScheduledTaskNavigationRow }[]) =>
    resolveSectionLamp(
      countSectionLampTones(
        entries.map(({ key, row }) => scheduledTaskLampTone(organization, key, row.task)),
      ),
    );

  const groupProps = (
    id: ScheduledTaskGroupId,
    entries: readonly { key: string; row: ScheduledTaskNavigationRow }[],
  ) => ({
    lamp: lampOf(entries),
    collapsed: organization.collapsedGroups.includes(id),
    onToggle: () => setOrganization((current) => toggleScheduledTaskGroup(current, id)),
  });

  const renderTask = ({ key, row }: { key: string; row: ScheduledTaskNavigationRow }) => (
    <ScheduledTaskNavigationItem
      key={key}
      row={row}
      selected={props.selectedKey === key}
      pinned={pinnedKeys.has(key)}
      unread={isScheduledTaskUnread(organization, key, row.task)}
      onMarkRead={() =>
        setOrganization((current) => markScheduledTaskSeen(current, key, row.task, Date.now()))
      }
      onMarkUnread={() => setOrganization((current) => markScheduledTaskUnseen(current, key))}
      sectionId={sectionIdsByTask.get(key) ?? null}
      sections={organization.sections}
      onSelect={props.onSelect}
      onTogglePin={() => setOrganization((current) => toggleScheduledTaskPin(current, key))}
      onMove={(sectionId) =>
        setOrganization((current) => moveScheduledTaskToSection(current, key, sectionId))
      }
    />
  );

  if (props.pinnedOnly) {
    return pinnedRows.length === 0 ? null : (
      <div className="ml-3 space-y-0.5 border-l border-sidebar-border py-1 pl-1.5">
        {pinnedRows.map(renderTask)}
      </div>
    );
  }

  return (
    <div className="border-l border-sidebar-border ml-3 pl-1.5">
      <div className="space-y-px py-1">
        {pinnedRows.length > 0 ? (
          <ScheduledNavigationGroup
            title={gt("Pinned")}
            icon={<PinIcon />}
            {...groupProps("pinned", pinnedRows)}
          >
            {pinnedRows.map(renderTask)}
          </ScheduledNavigationGroup>
        ) : null}

        {organization.sections.map((section) => {
          const rows = section.taskKeys.flatMap((key) => {
            const row = rowsByKey.get(key);
            return row === undefined || pinnedKeys.has(key) ? [] : [{ key, row }];
          });
          return (
            <ScheduledSubsection
              key={section.id}
              section={section}
              lamp={lampOf(rows)}
              onToggle={() =>
                setOrganization((current) => ({
                  ...current,
                  sections: current.sections.map((candidate) =>
                    candidate.id === section.id
                      ? { ...candidate, collapsed: !candidate.collapsed }
                      : candidate,
                  ),
                }))
              }
              onRename={() => setRenamingSection(section)}
              onRemove={() =>
                setOrganization((current) => removeScheduledTaskSection(current, section.id))
              }
            >
              {section.collapsed ? null : rows.map(renderTask)}
            </ScheduledSubsection>
          );
        })}

        {automatic.upcoming.length > 0 ? (
          <ScheduledNavigationGroup
            title={gt("Upcoming")}
            icon={<CalendarIcon />}
            {...groupProps("upcoming", automatic.upcoming)}
          >
            {automatic.upcoming.map(renderTask)}
          </ScheduledNavigationGroup>
        ) : null}

        {automatic.all.length > 0 ? (
          <ScheduledNavigationGroup
            title={gt("All tasks")}
            icon={<LayersIcon />}
            {...groupProps("all", automatic.all)}
          >
            {automatic.all.map(renderTask)}
          </ScheduledNavigationGroup>
        ) : null}

        {automatic.completed.length > 0 ? (
          <ScheduledNavigationGroup
            title={gt("Completed")}
            icon={<CircleCheckIcon />}
            {...groupProps("completed", automatic.completed)}
          >
            {automatic.completed.map(renderTask)}
          </ScheduledNavigationGroup>
        ) : null}

        {props.rows.length === 0 ? (
          <p role="status" className="px-2 py-2 text-xs text-sidebar-muted-foreground">
            {props.loading ? gt("Loading scheduled tasks…") : gt("No scheduled tasks")}
          </p>
        ) : null}
      </div>

      {nameDialog !== undefined ? (
        <ScheduledSubsectionNameDialog
          section={nameDialog}
          onClose={closeNameDialog}
          onSave={saveSectionName}
        />
      ) : null}
    </div>
  );
}

function ScheduledNavigationGroup(props: {
  readonly title: string;
  readonly icon: React.ReactNode;
  readonly lamp: SectionLamp | null;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly children: React.ReactNode;
}) {
  const contentId = useId();
  return (
    <section className="mb-3">
      <h2>
        <button
          type="button"
          aria-expanded={!props.collapsed}
          aria-controls={contentId}
          onClick={props.onToggle}
          className="flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs font-medium text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&>svg]:size-3.5"
        >
          {props.icon}
          <span className="min-w-0 flex-1 truncate">{props.title}</span>
          {props.collapsed && props.lamp ? <SidebarSectionLamp lamp={props.lamp} /> : null}
          <ChevronDownIcon
            aria-hidden
            className={cn("transition-transform", props.collapsed && "-rotate-90")}
          />
        </button>
      </h2>
      <div id={contentId} hidden={props.collapsed} className="space-y-0.5">
        {props.collapsed ? null : props.children}
      </div>
    </section>
  );
}

function ScheduledSubsection(props: {
  readonly section: ScheduledTaskSection;
  readonly lamp: SectionLamp | null;
  readonly onToggle: () => void;
  readonly onRename: () => void;
  readonly onRemove: () => void;
  readonly children: React.ReactNode;
}) {
  const gt = useGT();
  return (
    <section className="mb-2">
      <div className="group flex items-center rounded-md hover:bg-sidebar-row-hover">
        <button
          type="button"
          className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-expanded={!props.section.collapsed}
          onClick={props.onToggle}
        >
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-sidebar-muted-foreground transition-transform",
              props.section.collapsed && "-rotate-90",
            )}
          />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{props.section.name}</span>
          {props.section.collapsed && props.lamp ? <SidebarSectionLamp lamp={props.lamp} /> : null}
        </button>
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost-muted"
                className="mr-1"
                aria-label={gt("Options for {section}", { section: props.section.name })}
              />
            }
          >
            <EllipsisIcon aria-hidden />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={props.onRename}>{gt("Rename subsection")}</MenuItem>
            <MenuSeparator />
            <MenuItem variant="destructive" onClick={props.onRemove}>
              {gt("Remove subsection")}
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      {props.section.collapsed ? null : <div className="space-y-0.5">{props.children}</div>}
    </section>
  );
}

function ScheduledTaskNavigationItem(props: {
  readonly row: ScheduledTaskNavigationRow;
  readonly selected: boolean;
  readonly pinned: boolean;
  readonly unread: boolean;
  readonly sectionId: string | null;
  readonly sections: readonly ScheduledTaskSection[];
  readonly onSelect: () => void;
  readonly onTogglePin: () => void;
  readonly onMarkRead: () => void;
  readonly onMarkUnread: () => void;
  readonly onMove: (sectionId: string | null) => void;
}) {
  const gt = useGT();
  const router = useRouter();
  const { task, environmentId } = props.row;
  const actions = useScheduledTaskActions(environmentId);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const status = task.lastRunStatus;
  const failed = status === "failed";
  const completedOnce = scheduledTaskState(task) === "completed";
  return (
    <div
      className={cn(
        "group flex min-w-0 items-center rounded-md",
        props.selected
          ? "bg-sidebar-row-hover text-sidebar-foreground"
          : "hover:bg-sidebar-row-hover",
      )}
    >
      <Link
        to="/scheduled"
        search={{ environmentId, taskId: task.id }}
        preload="intent"
        resetScroll={false}
        aria-current={props.selected ? "page" : undefined}
        className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-(--control-radius) px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={props.onSelect}
      >
        <span
          aria-hidden
          data-unread={props.unread ? "" : undefined}
          className="flex size-2 shrink-0 items-center justify-center"
        >
          {status === "running" ? (
            <span className="size-2 rounded-full border border-info" />
          ) : props.unread ? (
            <span
              className={cn("size-1.5 rounded-full", failed ? "bg-destructive" : "bg-success")}
            />
          ) : null}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm",
            props.unread || props.selected
              ? "text-sidebar-foreground"
              : "text-sidebar-muted-foreground",
          )}
        >
          {task.title}
        </span>
        <ScheduledTaskStateLabel task={task} showFailed={failed && !props.unread} />
      </Link>
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost-muted"
              className="mr-1"
              aria-label={gt("Options for {task}", { task: task.title })}
            />
          }
        >
          <EllipsisIcon aria-hidden />
        </MenuTrigger>
        <MenuPopup align="end">
          {props.unread ? (
            <MenuItem onClick={props.onMarkRead}>
              <MailCheckIcon />
              {gt("Mark as read")}
            </MenuItem>
          ) : hasFinishedScheduledRun(task) ? (
            <MenuItem onClick={props.onMarkUnread}>
              <MailIcon />
              {gt("Mark as unread")}
            </MenuItem>
          ) : null}
          <MenuItem onClick={props.onTogglePin}>
            {props.pinned ? <PinOffIcon /> : <PinIcon />}
            {props.pinned ? gt("Unpin task") : gt("Pin task")}
          </MenuItem>
          <MenuSub>
            <MenuSubTrigger>{gt("Move to subsection")}</MenuSubTrigger>
            <MenuSubPopup>
              <SubsectionChoices
                currentId={props.sectionId}
                sections={props.sections}
                onMove={props.onMove}
              />
            </MenuSubPopup>
          </MenuSub>
          {actions.canEdit ? (
            <MenuItem onClick={() => setEditing(true)}>
              <PencilIcon />
              {gt("Edit")}
            </MenuItem>
          ) : null}
          {actions.canPause && !completedOnce ? (
            <MenuItem onClick={() => void actions.toggleEnabled(task)}>
              {task.enabled ? <PauseIcon /> : <PlayIcon />}
              {task.enabled ? gt("Pause") : gt("Resume")}
            </MenuItem>
          ) : null}
          {actions.canDelete ? (
            <>
              <MenuSeparator />
              <MenuItem variant="destructive" onClick={() => setDeleting(true)}>
                <Trash2Icon />
                {gt("Delete")}
              </MenuItem>
            </>
          ) : null}
        </MenuPopup>
      </Menu>
      {editing ? (
        <Suspense fallback={null}>
          <ScheduledTaskEditor
            key={JSON.stringify([environmentId, task.id])}
            initialEnvironmentId={environmentId}
            task={task}
            onClose={() => setEditing(false)}
          />
        </Suspense>
      ) : null}
      {deleting ? (
        <ScheduledTaskDeleteDialog
          task={task}
          onClose={() => setDeleting(false)}
          onDelete={async () => {
            // A run's chat stays open; only the task's own page goes away with it.
            const onTaskPage = isScheduledWorkspacePath(router.state.location.pathname);
            if ((await actions.deleteTask(task)) && props.selected && onTaskPage) {
              void router.navigate({ to: "/scheduled", search: {} });
            }
          }}
        />
      ) : null}
    </div>
  );
}

function SubsectionChoices({
  currentId,
  sections,
  onMove,
}: {
  readonly currentId: string | null;
  readonly sections: readonly ScheduledTaskSection[];
  readonly onMove: (id: string | null) => void;
}) {
  const gt = useGT();
  return (
    <>
      <MenuItem onClick={() => onMove(null)}>
        {currentId === null ? <CheckIcon /> : <span className="size-4" />}
        {gt("No subsection")}
      </MenuItem>
      {sections.map((section) => (
        <MenuItem key={section.id} onClick={() => onMove(section.id)}>
          {currentId === section.id ? <CheckIcon /> : <span className="size-4" />}
          {section.name}
        </MenuItem>
      ))}
    </>
  );
}

function ScheduledSubsectionNameDialog(props: {
  readonly section: ScheduledTaskSection | null;
  readonly onClose: () => void;
  readonly onSave: (name: string) => void;
}) {
  const gt = useGT();
  const [name, setName] = useState(props.section?.name ?? "");
  const input = useRef<HTMLInputElement>(null);
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogPopup initialFocus={input}>
        <DialogTitle>{props.section ? gt("Rename subsection") : gt("New subsection")}</DialogTitle>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (trimmed) props.onSave(trimmed);
          }}
        >
          <Input
            ref={input}
            aria-label={gt("Subsection name")}
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {gt("Cancel")}
            </DialogClose>
            <Button type="submit" disabled={!name.trim()}>
              {props.section ? gt("Save") : gt("Create subsection")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function ScheduledTaskStateLabel({
  task,
  showFailed,
}: {
  readonly task: ScheduledTask;
  readonly showFailed: boolean;
}) {
  const gt = useGT();
  const locale = useLocale();
  const state = scheduledTaskState(task);
  const label =
    state === "completed"
      ? gt("Completed")
      : state === "paused"
        ? gt("Paused")
        : state === "not_started"
          ? gt("Not started")
          : null;
  const runAt =
    task.schedule.type === "once" && state !== "completed"
      ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(
          new Date(task.schedule.runAt),
        )
      : null;
  const parts = [runAt, label, showFailed ? gt("Failed") : null].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <span className="shrink-0 text-3xs text-sidebar-muted-foreground">{parts.join(" · ")}</span>
  );
}
