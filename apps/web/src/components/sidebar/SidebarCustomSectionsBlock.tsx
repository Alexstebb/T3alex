import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  scopedProjectKey,
  scopeProjectRef,
  scopedThreadKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  findProjectByPath,
  inferProjectTitleFromPath,
  resolveProjectPathForDispatch,
} from "@t3tools/client-runtime/state/projects";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type ContextMenuItem,
  type ContextMenuSource,
  type EnvironmentId,
  type LocalApi,
} from "@t3tools/contracts";
import { isAbsolutePath } from "@t3tools/shared/path";
import { useNavigate } from "@tanstack/react-router";
import { useGT, useMessages } from "gt-react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { cloneElement, isValidElement, useState, type ComponentProps, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";

import { newProjectId, randomUUID } from "~/lib/utils";
import { useComposerDraftStore, type DraftId } from "../../composerDraftStore";
import { isElectron } from "../../env";
import type { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { readLocalApi } from "../../localApi";
import { useProjects, waitForProject } from "../../state/entities";
import { useConnectedEnvironmentIds, usePrimaryEnvironmentId } from "../../state/environments";
import { projectEnvironment } from "../../state/projects";
import { readEnvironmentScope } from "../../state/session";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useAtomCommand } from "../../state/use-atom-command";
import type { SidebarSection } from "../Sidebar.logic";
import { useSidebar } from "../ui/sidebar";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  SidebarCustomSectionHeader,
  SidebarSectionFolderDialog,
  SidebarSectionNameDialog,
} from "./SidebarCustomSection";
import type { SidebarDraftBlock } from "./SidebarDraftBlock";
import {
  closeSectionFolderDialog,
  customSectionAtPoint,
  linkSidebarSectionProject,
  moveThreadsToSidebarSection,
  openSectionFolderDialog,
  setSidebarSectionChatProject,
  setSidebarSections,
  showFewerSectionRows,
  showMoreSectionRows,
  sidebarSectionChatProject,
  sidebarSectionRowId,
  useSectionFolderDialogRequest,
  useSidebarSectionThreads,
  useStartSidebarSectionChat,
  type CustomSectionThreads,
  type CustomSidebarSection,
  type SidebarSectionDragRole,
  type SidebarSectionFolderMode,
  type SidebarSectionIndex,
} from "./sidebarSections";
import { SECTION_ROW_PAGE_COUNT } from "./sidebarSectionArrangement.logic";
import { isReadClearableTone } from "./sidebarSectionLamp.logic";
import { useMarkThreadsRead } from "./useMarkThreadsRead";

type SectionMenuAction = `section:${string}`;
type SidebarDraftBlockProps = ComponentProps<typeof SidebarDraftBlock>;

const NO_DRAFT_IDS: readonly DraftId[] = [];

function isSectionMenuAction(action: string): action is SectionMenuAction {
  return action.startsWith("section:");
}

function threadShellKey(thread: Pick<EnvironmentThreadShell, "environmentId" | "id">) {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

/**
 * Everything the sidebar needs for custom sections: dialogs, menu entries, drag and drop,
 * drafts per section and the rows under the active placeholder.
 */
export function useSidebarCustomSections(input: {
  readonly sectionIndex: SidebarSectionIndex;
  readonly threads: CustomSectionThreads;
  readonly draftIds: readonly DraftId[];
  readonly newThreadContext: Pick<
    ReturnType<typeof useHandleNewThread>,
    "handleNewThread" | "defaultProjectRef"
  >;
  readonly connectedEnvironmentIds: readonly EnvironmentId[];
}) {
  const { sectionIndex, threads, draftIds, newThreadContext } = input;
  const { sections } = sectionIndex;
  const gt = useGT();
  const messages = useMessages();
  const { isMobile, setOpenMobile } = useSidebar();
  const projects = useProjects();
  const folderRequest = useSectionFolderDialogRequest();
  const folderSection =
    folderRequest === null
      ? null
      : (sections.find((section) => section.id === folderRequest.sectionId) ?? null);
  const [nameDialog, setNameDialog] = useState<{
    section: CustomSidebarSection | null;
    threadKeys: readonly string[];
  } | null>(null);
  const startChatInSection = useStartSidebarSectionChat(newThreadContext.handleNewThread);
  const navigate = useNavigate();
  const markThreadsRead = useMarkThreadsRead();
  const { toneOf } = sectionIndex.display;
  useSidebarSectionThreads(sections, input.connectedEnvironmentIds);
  const draftSectionIds = useComposerDraftStore(
    useShallow((store) =>
      draftIds.map((draftId) => {
        const session = store.draftThreadsByThreadKey[draftId];
        return session
          ? sectionIndex.forThread(session.environmentId, session.threadId, session.projectId)
          : null;
      }),
    ),
  );
  const unassignedDraftIds = draftSectionIds.every((sectionId) => sectionId === null)
    ? draftIds
    : draftIds.filter((_, index) => draftSectionIds[index] === null);
  const sectionDraftIds = new Map<string, DraftId[]>();
  for (const [index, sectionId] of draftSectionIds.entries()) {
    const draftId = draftIds[index];
    if (sectionId === null || draftId === undefined) continue;
    const group = sectionDraftIds.get(sectionId);
    if (group) group.push(draftId);
    else sectionDraftIds.set(sectionId, [draftId]);
  }
  const hasSections = sections.length > 0;
  const { sectionIdByThread, renderedThreadKeys } = threads;

  const menuItem = (threadKeys: readonly string[]): ContextMenuItem<SectionMenuAction> => ({
    id: "section:menu",
    label: gt("Move to section"),
    icon: "folder-tree",
    children: [
      ...sections.map((section) => ({
        id: `section:${section.id}` as const,
        label: section.name,
        checked: threadKeys.every((key) => sectionIdByThread.get(key) === section.id),
      })),
      { id: "section:new", label: gt("New section"), separatorBefore: sections.length > 0 },
      ...(threadKeys.some((key) => sectionIdByThread.has(key))
        ? [{ id: "section:clear" as const, label: gt("Remove from section") }]
        : []),
    ],
  });
  const applyMenuAction = (action: SectionMenuAction, threadKeys: readonly string[]) => {
    if (action === "section:new") {
      setNameDialog({ section: null, threadKeys });
    } else {
      const sectionId = action === "section:clear" ? null : action.slice("section:".length);
      setSidebarSections((current) => moveThreadsToSidebarSection(current, threadKeys, sectionId));
    }
  };
  const saveSectionName = (name: string) => {
    if (nameDialog === null) return;
    const { section, threadKeys } = nameDialog;
    if (section === null) {
      const id = randomUUID();
      setSidebarSections((current) =>
        moveThreadsToSidebarSection(
          [...current, { id, name, collapsed: false, threadKeys: [] }],
          threadKeys,
          id,
        ),
      );
    } else {
      setSidebarSections((current) =>
        current.map((item) => (item.id === section.id ? { ...item, name } : item)),
      );
    }
    setNameDialog(null);
  };
  const reorderSection = (id: string, direction: -1 | 1) => {
    setSidebarSections((current) => {
      const index = current.findIndex((section) => section.id === id);
      const neighbor = current[index + direction];
      const section = current[index];
      if (!neighbor || !section) return current;
      return current.with(index, neighbor).with(index + direction, section);
    });
  };
  const startChat = (section: CustomSidebarSection) => {
    if (isMobile) setOpenMobile(false);
    void startChatInSection(section, newThreadContext.defaultProjectRef).catch((error: unknown) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Could not start a chat in this section"),
          description: thrownErrorMessage(error, messages) ?? gt("An error occurred."),
        }),
      );
    });
  };
  // A row that only a section can take skips the built-in shelf drop.
  const ownsRowDrag = (activeKey: string, draggableThreadKeys: ReadonlySet<string>) =>
    renderedThreadKeys.has(activeKey) || !draggableThreadKeys.has(activeKey);

  return {
    sectionIndex,
    hasSections,
    unassignedDraftIds,
    renderedThreadKeys,
    layoutKey: threads.layoutKey,
    folderDialog:
      folderSection === null || folderRequest === null
        ? null
        : { section: folderSection, mode: folderRequest.mode },
    nameDialog,
    closeNameDialog: () => setNameDialog(null),
    saveSectionName,
    openNewSection: () => setNameDialog({ section: null, threadKeys: [] }),
    dragRole: (threadKey: string): SidebarSectionDragRole | undefined =>
      hasSections ? (renderedThreadKeys.has(threadKey) ? "member" : "row") : undefined,
    ownsRowDrag,
    // Section drops and rows only a section can take don't project the built-in shelf order.
    isContextDrag: (
      drag: { readonly activeKey: string; readonly targetCustomSectionId: string | null } | null,
      draggableThreadKeys: ReadonlySet<string>,
    ) =>
      drag !== null &&
      (ownsRowDrag(drag.activeKey, draggableThreadKeys) || drag.targetCustomSectionId !== null),
    dropTargetAt: (list: HTMLElement | null, point: { readonly x: number; readonly y: number }) =>
      hasSections ? customSectionAtPoint(list, point, sectionIdByThread) : null,
    dropThreads: (threadKeys: readonly string[], sectionId: string) =>
      setSidebarSections((current) => moveThreadsToSidebarSection(current, threadKeys, sectionId)),
    /**
     * Wraps a context menu so it offers "Move to section" (first, or before `insertBefore`)
     * and handles that pick itself, resolving null as a dismissed menu does.
     */
    threadMenu: (
      contextMenu: Pick<LocalApi["contextMenu"], "show">,
      threadKeys: readonly string[],
      insertBefore?: string,
    ) => ({
      show: async <T extends string>(
        items: readonly ContextMenuItem<T>[],
        position?: { x: number; y: number },
        source?: ContextMenuSource,
      ): Promise<T | null> => {
        const found =
          insertBefore === undefined ? 0 : items.findIndex((item) => item.id === insertBefore);
        const at = found === -1 ? items.length : found;
        const clicked = await contextMenu.show<T | SectionMenuAction>(
          [...items.slice(0, at), menuItem(threadKeys), ...items.slice(at)],
          position,
          source,
        );
        if (clicked === null || !isSectionMenuAction(clicked)) return clicked as T | null;
        applyMenuAction(clicked, threadKeys);
        return null;
      },
    }),
    /**
     * The section headers with their drafts and rows. Section drafts reuse the props of the
     * main draft block (`draftBlock`) with their own draft ids.
     */
    renderSections: (
      renderThreadRow: (
        thread: EnvironmentThreadShell,
        section: SidebarSection,
        folderRow?: string,
      ) => ReactNode,
      draftBlock: ReactNode,
      dropTargetId: string | null,
    ): ReactNode[] => {
      const rows: ReactNode[] = [];
      const connected = new Set(input.connectedEnvironmentIds);
      for (const [index, group] of threads.groups.entries()) {
        const { section } = group;
        const target = sidebarSectionChatProject(section, (ref) => {
          const key = scopedProjectKey(ref);
          return (
            projects.find(
              (project) =>
                scopedProjectKey(scopeProjectRef(project.environmentId, project.id)) === key,
            ) ?? null
          );
        });
        const unread = [...group.threads, ...group.hiddenThreads].filter((thread) =>
          isReadClearableTone(toneOf(thread)),
        );
        rows.push(
          <SidebarCustomSectionHeader
            key={section.id}
            section={section}
            isDropTarget={dropTargetId === section.id}
            lamp={group.lamp}
            lampEntries={group.hiddenThreads.flatMap((thread) => {
              const tone = toneOf(thread);
              return tone === null
                ? []
                : [
                    {
                      key: threadShellKey(thread),
                      tone,
                      title: thread.title,
                      onOpen: () => {
                        if (isMobile) setOpenMobile(false);
                        void navigate({
                          to: "/$environmentId/$threadId",
                          params: buildThreadRouteParams(
                            scopeThreadRef(thread.environmentId, thread.id),
                          ),
                        });
                      },
                    },
                  ];
            })}
            onMarkAllRead={unread.length > 0 ? () => markThreadsRead(unread) : undefined}
            folderName={target?.available ? target.project?.title : undefined}
            // Projects of an environment that is not connected yet are unknown, not missing.
            folderMissing={
              target !== null &&
              !target.available &&
              (target.ref === null || connected.has(target.ref.environmentId))
            }
            canMoveUp={index > 0}
            canMoveDown={index < threads.groups.length - 1}
            onToggle={() =>
              setSidebarSections((current) =>
                current.map((item) =>
                  item.id === section.id ? { ...item, collapsed: !item.collapsed } : item,
                ),
              )
            }
            onRename={() => setNameDialog({ section, threadKeys: [] })}
            onNewChat={() => startChat(section)}
            onLinkFolder={() => openSectionFolderDialog(section.id, "link")}
            onChooseChatFolder={() => openSectionFolderDialog(section.id, "chat")}
            onClearChatFolder={() =>
              setSidebarSections((current) =>
                setSidebarSectionChatProject(current, section.id, undefined),
              )
            }
            onUnlinkFolder={() =>
              setSidebarSections((current) =>
                linkSidebarSectionProject(current, section.id, undefined),
              )
            }
            onMove={(direction) => reorderSection(section.id, direction)}
            onRemove={() =>
              setSidebarSections((current) => current.filter((item) => item.id !== section.id))
            }
          />,
        );
        if (!section.collapsed && isValidElement<SidebarDraftBlockProps>(draftBlock)) {
          rows.push(
            cloneElement(draftBlock, {
              key: `drafts:${section.id}`,
              draftIds: sectionDraftIds.get(section.id) ?? NO_DRAFT_IDS,
              navigationParent: sidebarSectionRowId(section.id),
            }),
          );
        }
        for (const thread of group.threads) {
          rows.push(
            renderThreadRow(
              thread,
              threads.sectionByThreadKey.get(threadShellKey(thread))!,
              sidebarSectionRowId(section.id),
            ),
          );
        }
        const moreRow = (kind: "more" | "less") => (
          <li key={`${kind}:${section.id}`} className="list-none">
            <button
              type="button"
              data-sidebar-row={`${sidebarSectionRowId(section.id)}:${kind}`}
              data-sidebar-parent={sidebarSectionRowId(section.id)}
              onClick={() =>
                kind === "more" ? showMoreSectionRows(section.id) : showFewerSectionRows(section.id)
              }
              className="flex h-7 w-full cursor-pointer items-center gap-2.5 rounded-md px-(--sidebar-row-content-inset) text-left text-xs text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              {/* Plus means "add", so revealing more uses a chevron, as the settled shelf does. */}
              {kind === "more" ? (
                <ChevronDownIcon aria-hidden className="size-3.5 shrink-0" />
              ) : (
                <ChevronUpIcon aria-hidden className="size-3.5 shrink-0" />
              )}
              {kind === "more"
                ? gt("{count, plural, one {Show {count} more} other {Show {count} more}}", {
                    count: Math.min(group.foldedCount, SECTION_ROW_PAGE_COUNT),
                  })
                : gt("Show less")}
            </button>
          </li>
        );
        if (group.foldedCount > 0) rows.push(moreRow("more"));
        if (group.unfolded) rows.push(moreRow("less"));
      }
      return rows;
    },
  };
}

type SidebarCustomSectionsModel = ReturnType<typeof useSidebarCustomSections>;

export function SidebarCustomSectionDialogs({
  sections,
}: {
  sections: SidebarCustomSectionsModel;
}) {
  return (
    <>
      {sections.folderDialog ? (
        <SectionFolderDialog
          key={`${sections.folderDialog.section.id}:${sections.folderDialog.mode}`}
          section={sections.folderDialog.section}
          mode={sections.folderDialog.mode}
          sections={sections.sectionIndex.sections}
          onClose={closeSectionFolderDialog}
        />
      ) : null}
      {sections.nameDialog ? (
        <SidebarSectionNameDialog
          section={sections.nameDialog.section}
          onClose={sections.closeNameDialog}
          onSave={sections.saveSectionName}
        />
      ) : null}
    </>
  );
}

function SectionFolderDialog(props: {
  section: CustomSidebarSection;
  mode: SidebarSectionFolderMode;
  sections: readonly CustomSidebarSection[];
  onClose: () => void;
}) {
  const { section, sections, mode } = props;
  const gt = useGT();
  const messages = useMessages();
  const projects = useProjects();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const connectedEnvironmentIds = useConnectedEnvironmentIds();
  const createSectionProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const currentKey = mode === "link" ? section.projectKey : section.chatProjectKey;
  const currentProject =
    currentKey === undefined
      ? undefined
      : projects.find(
          (project) =>
            scopedProjectKey(scopeProjectRef(project.environmentId, project.id)) === currentKey,
        );
  const linkFolder = async (path: string) => {
    const environmentId = primaryEnvironmentId;
    if (environmentId === null) {
      return gt("The selected environment is not connected.");
    }
    const workspaceRoot = resolveProjectPathForDispatch(path);
    if (!isAbsolutePath(workspaceRoot)) return gt("Enter an absolute folder path.");
    const existing = findProjectByPath(
      projects.filter((project) => project.environmentId === environmentId),
      workspaceRoot,
    );
    if (existing?.archivedAt != null) return gt("Restore the project before linking it.");
    const projectId = existing?.id ?? newProjectId();
    const projectKey = scopedProjectKey(scopeProjectRef(environmentId, projectId));
    if (
      mode === "link" &&
      sections.some((item) => item.id !== section.id && item.projectKey === projectKey)
    ) {
      return gt("This project is already linked to a section.");
    }
    if (!existing) {
      if (!connectedEnvironmentIds.includes(environmentId)) {
        return gt("The selected environment is not connected.");
      }
      if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) {
        return gt("This connection cannot add projects.");
      }
      const result = await createSectionProject({
        environmentId,
        input: {
          projectId,
          title: inferProjectTitleFromPath(workspaceRoot),
          workspaceRoot,
          createWorkspaceRootIfMissing: false,
          defaultModelSelection: null,
        },
      });
      if (result._tag === "Failure") {
        return (
          thrownErrorMessage(squashAtomCommandFailure(result), messages) ??
          gt("Could not link the folder.")
        );
      }
      await waitForProject(scopeProjectRef(environmentId, projectId));
    }
    setSidebarSections((current) =>
      mode === "link"
        ? linkSidebarSectionProject(current, section.id, projectKey)
        : setSidebarSectionChatProject(current, section.id, projectKey),
    );
    return null;
  };
  return (
    <SidebarSectionFolderDialog
      initialPath={currentProject?.archivedAt == null ? (currentProject?.workspaceRoot ?? "") : ""}
      mode={mode}
      {...(isElectron
        ? { onBrowse: async () => (await readLocalApi()?.dialogs.pickFolder()) ?? null }
        : {})}
      onClose={props.onClose}
      onLink={linkFolder}
    />
  );
}
