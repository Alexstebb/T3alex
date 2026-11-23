import { Link } from "@tanstack/react-router";
import { useGT } from "gt-react";
import {
  CheckIcon,
  ChevronDownIcon,
  EllipsisIcon,
  LayersIcon,
  PinIcon,
  PinOffIcon,
} from "lucide-react";
import { useRef, useState } from "react";

import {
  isCompletedOneTimeScheduledTask,
  type EnvironmentId,
  type ScheduledTask,
} from "@t3tools/contracts";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn, randomUUID } from "../../lib/utils";
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
  EMPTY_SCHEDULED_TASK_ORGANIZATION,
  indexScheduledTaskSections,
  moveScheduledTaskToSection,
  removeScheduledTaskSection,
  ScheduledTaskOrganization,
  scheduledTaskOrganizationKey,
  toggleScheduledTaskPin,
  type ScheduledTaskSection,
} from "./scheduledTaskOrganization";

interface ScheduledTaskNavigationRow {
  readonly environmentId: EnvironmentId;
  readonly task: ScheduledTask;
}

const STORAGE_KEY = "t3code:scheduled-task-organization";

export function ScheduledTaskNavigation(props: {
  readonly rows: readonly ScheduledTaskNavigationRow[];
  readonly selectedKey: string | null;
  readonly creatingSection: boolean;
  readonly onCloseCreateSection: () => void;
  readonly onSelect: () => void;
  readonly loading: boolean;
}) {
  const gt = useGT();
  const [organization, setOrganization] = useLocalStorage(
    STORAGE_KEY,
    EMPTY_SCHEDULED_TASK_ORGANIZATION,
    ScheduledTaskOrganization,
  );
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
  const unsectionedRows = [];
  for (const [key, row] of rowsByKey) {
    if (!pinnedKeys.has(key) && !sectionIdsByTask.has(key)) unsectionedRows.push({ key, row });
  }

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

  const renderTask = ({ key, row }: { key: string; row: ScheduledTaskNavigationRow }) => (
    <ScheduledTaskNavigationItem
      key={key}
      row={row}
      selected={props.selectedKey === key}
      pinned={pinnedKeys.has(key)}
      sectionId={sectionIdsByTask.get(key) ?? null}
      sections={organization.sections}
      onSelect={props.onSelect}
      onTogglePin={() => setOrganization((current) => toggleScheduledTaskPin(current, key))}
      onMove={(sectionId) =>
        setOrganization((current) => moveScheduledTaskToSection(current, key, sectionId))
      }
    />
  );

  return (
    <div className="border-l border-sidebar-border ml-3 pl-1.5">
      <div className="space-y-px py-1">
        {pinnedRows.length > 0 ? (
          <ScheduledNavigationGroup title={gt("Pinned")} icon={<PinIcon />}>
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
              count={rows.length}
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

        {unsectionedRows.length > 0 ? (
          <ScheduledNavigationGroup title={gt("All tasks")} icon={<LayersIcon />}>
            {unsectionedRows.map(renderTask)}
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
  readonly children: React.ReactNode;
}) {
  return (
    <section className="mb-3">
      <div className="flex h-7 items-center gap-2 px-2 text-xs font-medium text-sidebar-muted-foreground [&>svg]:size-3.5">
        {props.icon}
        <h2>{props.title}</h2>
      </div>
      <div className="space-y-0.5">{props.children}</div>
    </section>
  );
}

function ScheduledSubsection(props: {
  readonly section: ScheduledTaskSection;
  readonly count: number;
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
          {props.section.collapsed && props.count > 0 ? (
            <span className="text-xs tabular-nums text-sidebar-muted-foreground">
              {props.count}
            </span>
          ) : null}
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
  readonly sectionId: string | null;
  readonly sections: readonly ScheduledTaskSection[];
  readonly onSelect: () => void;
  readonly onTogglePin: () => void;
  readonly onMove: (sectionId: string | null) => void;
}) {
  const gt = useGT();
  const { task } = props.row;
  const status = task.lastRunStatus === "never" ? null : task.lastRunStatus;
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
        search={{ environmentId: props.row.environmentId, taskId: task.id }}
        preload="intent"
        resetScroll={false}
        aria-current={props.selected ? "page" : undefined}
        className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-(--control-radius) px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={props.onSelect}
      >
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full bg-sidebar-muted-foreground/45",
            status === "succeeded" && "bg-success",
            status === "failed" && "bg-destructive",
            status === "running" && "bg-info",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
        {!task.enabled ? (
          <span className="shrink-0 text-3xs text-sidebar-muted-foreground">
            {isCompletedOneTimeScheduledTask(task) ? gt("Completed") : gt("Paused")}
          </span>
        ) : null}
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
        </MenuPopup>
      </Menu>
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
