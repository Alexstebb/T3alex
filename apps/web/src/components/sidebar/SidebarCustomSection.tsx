import { useGT } from "gt-react";
import { ChevronDownIcon, EllipsisIcon, FolderIcon, LayersIcon, PlusIcon } from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Dialog, DialogClose, DialogFooter, DialogPopup, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { sidebarSectionRowId, type CustomSidebarSection } from "./sidebarSections";

export function SidebarCustomSectionHeader(props: {
  section: CustomSidebarSection;
  isDropTarget: boolean;
  count: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggle: () => void;
  onNewChat: () => void;
  onLinkFolder: () => void;
  onUnlinkFolder: () => void;
  onRename: () => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const gt = useGT();
  const { section } = props;
  const rowId = sidebarSectionRowId(section.id);

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
        {section.projectKey !== undefined ? (
          <FolderIcon aria-hidden className="size-3.5 shrink-0 text-sidebar-muted-foreground" />
        ) : (
          <LayersIcon aria-hidden className="size-3.5 shrink-0 text-sidebar-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{section.name}</span>
        {section.collapsed && props.count > 0 ? (
          <span aria-hidden className="shrink-0 text-xs tabular-nums text-sidebar-muted-foreground">
            {props.count}
          </span>
        ) : null}
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
              aria-label={gt("New chat in {section}", { section: section.name })}
              onClick={props.onNewChat}
            />
          }
        >
          <PlusIcon aria-hidden />
        </TooltipTrigger>
        <TooltipPopup>{gt("New chat in {section}", { section: section.name })}</TooltipPopup>
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
            {section.projectKey === undefined ? gt("Link folder") : gt("Change linked folder")}
          </MenuItem>
          {section.projectKey !== undefined ? (
            <MenuItem onClick={props.onUnlinkFolder}>{gt("Unlink folder")}</MenuItem>
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
        <DialogTitle>{gt("Link a project folder")}</DialogTitle>
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
              {gt("Link folder")}
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
