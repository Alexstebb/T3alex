import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useGT } from "gt-react";
import {
  ChevronDownIcon,
  EllipsisIcon,
  FolderIcon,
  LayersIcon,
  PlusIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { useUiStateStore } from "../../uiStateStore";
import { resolveThreadLastVisitedAt } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Dialog, DialogClose, DialogFooter, DialogPopup, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  sidebarSectionRowId,
  type CustomSidebarSection,
  type SidebarSectionFolderMode,
} from "./sidebarSections";
import { resolveSidebarSectionLamp } from "./sidebarSectionLamp.logic";
import { SidebarSectionLamp } from "./SidebarSectionLamp";

/** The lamp for a closed section's hidden chats, read with the same visit times as their rows. */
function useSectionLamp(threads: readonly EnvironmentThreadShell[]) {
  const localLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  if (threads.length === 0) return null;
  return resolveSidebarSectionLamp(
    threads.map((thread) => ({
      ...thread,
      lastVisitedAt: resolveThreadLastVisitedAt(
        thread.lastVisitedAt,
        localLastVisitedAtById[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))],
      ),
    })),
  );
}

export function SidebarCustomSectionHeader(props: {
  section: CustomSidebarSection;
  isDropTarget: boolean;
  /** The chats a closed section hides; empty while it is open. */
  hiddenThreads: readonly EnvironmentThreadShell[];
  /** The project new chats start in, when there is one and it still exists. */
  folderName: string | undefined;
  folderMissing: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggle: () => void;
  onNewChat: () => void;
  onLinkFolder: () => void;
  onUnlinkFolder: () => void;
  onChooseChatFolder: () => void;
  onClearChatFolder: () => void;
  onRename: () => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const gt = useGT();
  const { section } = props;
  const rowId = sidebarSectionRowId(section.id);
  const linked = section.projectKey !== undefined;
  const newChatLabel = gt("New chat in {section}", { section: section.name });
  const missingLabel = gt("This section's folder no longer exists as a project.");
  const lamp = useSectionLamp(props.hiddenThreads);

  return (
    <li
      data-sidebar-section-drop={section.id}
      data-drop-target={props.isDropTarget || undefined}
      className={cn(
        "mt-2 flex list-none items-center gap-1 rounded-(--control-radius) hover:bg-sidebar-row-hover",
        props.isDropTarget && "bg-primary/10 ring-1 ring-inset ring-primary/50",
      )}
    >
      <button
        type="button"
        data-sidebar-row={rowId}
        aria-expanded={!section.collapsed}
        onClick={props.onToggle}
        className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-(--control-radius) px-(--sidebar-row-content-inset) text-left text-sidebar-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {linked ? (
          <FolderIcon aria-hidden className="size-3.5 shrink-0 text-sidebar-muted-foreground" />
        ) : (
          <LayersIcon aria-hidden className="size-3.5 shrink-0 text-sidebar-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{section.name}</span>
        {props.folderMissing ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  role="img"
                  aria-label={missingLabel}
                  className="flex shrink-0 text-sidebar-muted-foreground"
                />
              }
            >
              <TriangleAlertIcon aria-hidden className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup>{missingLabel}</TooltipPopup>
          </Tooltip>
        ) : null}
        {lamp ? <SidebarSectionLamp lamp={lamp} /> : null}
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-3 shrink-0 text-sidebar-muted-foreground transition-transform",
            section.collapsed && "-rotate-90",
          )}
        />
      </button>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              data-sidebar-action-for={rowId}
              variant="ghost-muted"
              size="icon-xs"
              aria-label={newChatLabel}
              onClick={props.onNewChat}
            />
          }
        >
          <PlusIcon aria-hidden />
        </TooltipTrigger>
        <TooltipPopup>
          {props.folderName === undefined
            ? newChatLabel
            : gt("New chat in {section} · {folder}", {
                section: section.name,
                folder: props.folderName,
              })}
        </TooltipPopup>
      </Tooltip>
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost-muted"
              size="icon-xs"
              data-sidebar-action-for={rowId}
              aria-label={gt("Section options for {section}", { section: section.name })}
            />
          }
        >
          <EllipsisIcon aria-hidden />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem onClick={props.onRename}>{gt("Rename section")}</MenuItem>
          <MenuItem onClick={props.onLinkFolder}>
            {linked ? gt("Change linked folder") : gt("Link folder")}
          </MenuItem>
          {linked ? (
            <MenuItem onClick={props.onUnlinkFolder}>{gt("Unlink folder")}</MenuItem>
          ) : (
            <MenuItem onClick={props.onChooseChatFolder}>{gt("Start chats in folder…")}</MenuItem>
          )}
          {!linked && section.chatProjectKey !== undefined ? (
            <MenuItem onClick={props.onClearChatFolder}>
              {gt("Stop starting chats in a folder")}
            </MenuItem>
          ) : null}
          <MenuItem disabled={!props.canMoveUp} onClick={() => props.onMove(-1)}>
            {gt("Move up")}
          </MenuItem>
          <MenuItem disabled={!props.canMoveDown} onClick={() => props.onMove(1)}>
            {gt("Move down")}
          </MenuItem>
          <MenuSeparator />
          <MenuItem onClick={props.onRemove}>{gt("Remove section")}</MenuItem>
        </MenuPopup>
      </Menu>
    </li>
  );
}

export function SidebarSectionFolderDialog(props: {
  initialPath: string;
  mode: SidebarSectionFolderMode;
  onBrowse?: () => Promise<string | null>;
  onClose: () => void;
  onLink: (path: string) => Promise<string | null>;
}) {
  const gt = useGT();
  const [path, setPath] = useState(props.initialPath);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) props.onClose();
      }}
    >
      <DialogPopup initialFocus={input}>
        <DialogTitle>
          {props.mode === "link" ? gt("Link a project folder") : gt("Start new chats in a folder")}
        </DialogTitle>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || !path.trim()) return;
            setBusy(true);
            void props
              .onLink(path.trim())
              .then((failure) => {
                if (failure === null) props.onClose();
                else setError(failure);
              })
              .catch(() => setError(gt("Could not link the folder.")))
              .finally(() => setBusy(false));
          }}
        >
          <div className="flex items-center gap-2">
            <Input
              ref={input}
              aria-label={gt("Project folder path")}
              value={path}
              disabled={busy}
              onChange={(event) => {
                setPath(event.currentTarget.value);
                setError(null);
              }}
            />
            {props.onBrowse ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  try {
                    const picked = await props.onBrowse?.();
                    if (picked) {
                      setPath(picked);
                      setError(null);
                    }
                  } catch {
                    setError(gt("Could not choose a folder."));
                  }
                }}
              >
                {gt("Browse…")}
              </Button>
            ) : null}
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={busy} />}>
              {gt("Cancel")}
            </DialogClose>
            <Button type="submit" disabled={busy || !path.trim()}>
              {props.mode === "link" ? gt("Link folder") : gt("Use folder")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

export function SidebarSectionNameDialog(props: {
  section: CustomSidebarSection | null;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const gt = useGT();
  const [name, setName] = useState(props.section?.name ?? "");
  const input = useRef<HTMLInputElement>(null);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup initialFocus={input}>
        <DialogTitle>{props.section ? gt("Rename section") : gt("New section")}</DialogTitle>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) props.onSave(name.trim());
          }}
        >
          <Input
            ref={input}
            aria-label={gt("Section name")}
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {gt("Cancel")}
            </DialogClose>
            <Button type="submit" disabled={!name.trim()}>
              {props.section ? gt("Save") : gt("Create section")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
