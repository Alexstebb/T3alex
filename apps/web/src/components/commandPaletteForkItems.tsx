import type { ScopedProjectRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { CalendarClockIcon, FolderIcon, LayersIcon } from "lucide-react";

import type { NewThreadHandler } from "../hooks/useHandleNewThread";
import {
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
  type CommandPaletteGroup,
} from "./CommandPalette.logic";
import { expandScheduledSidebar } from "./scheduled/ScheduledSidebarGroup";
import { useSidebarSections, useStartSidebarSectionChat } from "./sidebar/sidebarSections";

/**
 * The fork's command palette entries: a "Sections" group in "New thread in..." for custom
 * sidebar sections, and "Open Scheduled".
 */
export function useCommandPaletteForkItems(
  handleNewThread: NewThreadHandler,
  defaultProjectRef: ScopedProjectRef | null,
) {
  const gt = useGT();
  const navigate = useNavigate();
  const [sidebarSections] = useSidebarSections();
  const startChatInSection = useStartSidebarSectionChat(handleNewThread);
  const sectionGroups: CommandPaletteGroup[] =
    sidebarSections.length === 0
      ? []
      : [
          {
            value: "new-chat-sections",
            label: gt("Sections"),
            items: sidebarSections.map((section) => ({
              kind: "action",
              value: `new-chat-in-section:${section.id}`,
              searchTerms: ["section", "chat", section.name],
              title: section.name,
              icon:
                section.projectKey === undefined ? (
                  <LayersIcon className={ITEM_ICON_CLASS} />
                ) : (
                  <FolderIcon className={ITEM_ICON_CLASS} />
                ),
              run: () => startChatInSection(section, defaultProjectRef),
            })),
          },
        ];
  const openScheduled: CommandPaletteActionItem = {
    kind: "action",
    value: "action:scheduled",
    searchTerms: ["schedule", "scheduled tasks", "automations", "runs"],
    title: gt("Open Scheduled"),
    icon: <CalendarClockIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      expandScheduledSidebar();
      await navigate({ to: "/scheduled" });
    },
  };
  return { sectionGroups, openScheduled };
}
