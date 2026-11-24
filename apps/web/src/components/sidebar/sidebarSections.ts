import * as Schema from "effect/Schema";
import { useEffect } from "react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  parseScopedProjectKey,
  parseScopedThreadKey,
  scopeProjectRef,
  scopedProjectKey,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import {
  SidebarCustomSection as SidebarCustomSectionSchema,
  type ClientSettings,
  type EnvironmentId,
  type ProjectId,
  type ScopedProjectRef,
  type SidebarCustomSection,
  type ThreadId,
} from "@t3tools/contracts";
import { useGT } from "gt-react";
import { create } from "zustand";

import { getLocalStorageItem, removeLocalStorageItem } from "../../hooks/useLocalStorage";
import {
  getClientSettings,
  persistClientSettingsPatch,
  persistClientSettingsUpdate,
  useClientSettings,
  useClientSettingsHydrated,
} from "../../hooks/useSettings";
import type { NewThreadHandler } from "../../hooks/useHandleNewThread";
import { useScratchProject } from "../../hooks/useScratchProject";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { readProject } from "../../state/entities";
import { environmentThreadShells, threadFamilies } from "../../state/threads";
import { orderItemsByPreferredIds, type SidebarSection } from "../Sidebar.logic";
import { stackedThreadToast, toastManager } from "../ui/toast";

const LEGACY_SECTIONS_STORAGE_KEY = "t3code:sidebar:custom-sections";
const LegacySidebarSections = Schema.Array(SidebarCustomSectionSchema);

export type CustomSidebarSection = SidebarCustomSection;

const selectSections = (settings: ClientSettings) => settings.sidebarCustomSections;

let legacySectionsImported = false;

// Sections used to live in browser storage, which is lost when the Electron profile
// is reset. Move them once into client settings, which live in the T3 home folder.
function importLegacySections() {
  if (legacySectionsImported) return;
  legacySectionsImported = true;
  let legacy: readonly SidebarCustomSection[] | null = null;
  try {
    legacy = getLocalStorageItem(LEGACY_SECTIONS_STORAGE_KEY, LegacySidebarSections);
  } catch {
    return;
  }
  if (legacy === null) return;
  const toImport = legacy;
  void persistClientSettingsUpdate((current) =>
    current.sidebarCustomSections.length > 0
      ? current
      : { ...current, sidebarCustomSections: toImport },
  ).then(() => {
    try {
      removeLocalStorageItem(LEGACY_SECTIONS_STORAGE_KEY);
    } catch {
      // The import is idempotent, so a leftover key is harmless.
    }
  });
}

export function useSidebarSections() {
  const sections = useClientSettings(selectSections);
  const hydrated = useClientSettingsHydrated();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- one-time import of sections saved by older builds in browser storage
  useEffect(() => {
    if (hydrated) importLegacySections();
  }, [hydrated]);
  return [sections, setSidebarSections] as const;
}

export function setSidebarSections(
  value:
    | readonly SidebarCustomSection[]
    | ((current: readonly SidebarCustomSection[]) => readonly SidebarCustomSection[]),
) {
  const next =
    typeof value === "function" ? value(getClientSettings().sidebarCustomSections) : value;
  void persistClientSettingsPatch({ sidebarCustomSections: next });
}

export function useSidebarSectionIndex() {
  const [sections] = useSidebarSections();
  return indexSidebarSections(sections);
}

export function sidebarSectionRowId(id: string) {
  return `custom-section:${id}`;
}

function indexSidebarSections(sections: readonly CustomSidebarSection[]) {
  const manual = new Map(
    sections.flatMap((section) => section.threadKeys.map((key) => [key, section.id] as const)),
  );
  const linked = new Map(
    sections.flatMap((section) =>
      section.projectKey === undefined
        ? []
        : [
            [
              section.projectKey,
              { id: section.id, excluded: new Set(section.excludedThreadKeys) },
            ] as const,
          ],
    ),
  );
  return {
    sections,
    linked,
    // An empty folder stays hidden when every project in it belongs to a linked section.
    linksEveryProject(projectRefs: readonly ScopedProjectRef[]) {
      return projectRefs.every((ref) => linked.has(scopedProjectKey(ref)));
    },
    forThread(environmentId: EnvironmentId, threadId: ThreadId, projectId: ProjectId) {
      if (manual.size === 0 && linked.size === 0) return null;
      const key = scopedThreadKey(scopeThreadRef(environmentId, threadId));
      const assigned = manual.get(key);
      if (assigned !== undefined) return assigned;
      const match = linked.get(scopedProjectKey(scopeProjectRef(environmentId, projectId)));
      return match && !match.excluded.has(key) ? match.id : null;
    },
  };
}

export function linkSidebarSectionProject(
  sections: readonly CustomSidebarSection[],
  sectionId: string,
  projectKey: string | undefined,
) {
  if (
    projectKey !== undefined &&
    sections.some((section) => section.id !== sectionId && section.projectKey === projectKey)
  )
    return sections;
  return sections.map((section) => {
    if (section.id !== sectionId || section.projectKey === projectKey) return section;
    const { projectKey: _oldProjectKey, excludedThreadKeys: _excluded, ...unlinked } = section;
    return projectKey === undefined ? unlinked : { ...unlinked, projectKey };
  });
}

export function setSidebarSectionChatProject(
  sections: readonly CustomSidebarSection[],
  sectionId: string,
  chatProjectKey: string | undefined,
) {
  return sections.map((section): CustomSidebarSection => {
    if (section.id !== sectionId || section.chatProjectKey === chatProjectKey) return section;
    const { chatProjectKey: _old, ...rest } = section;
    return chatProjectKey === undefined ? rest : { ...rest, chatProjectKey };
  });
}

/** "link" sets the section's linked project, "chat" the project its new chats start in. */
export type SidebarSectionFolderMode = "link" | "chat";

const useSectionFolderDialogStore = create<{
  readonly request: { readonly sectionId: string; readonly mode: SidebarSectionFolderMode } | null;
}>(() => ({ request: null }));

export function useSectionFolderDialogRequest() {
  return useSectionFolderDialogStore((state) => state.request);
}

// A store rather than sidebar state, so the command palette can open the dialog too.
export function openSectionFolderDialog(sectionId: string, mode: SidebarSectionFolderMode) {
  useSectionFolderDialogStore.setState({ request: { sectionId, mode } });
}

export function closeSectionFolderDialog() {
  useSectionFolderDialogStore.setState({ request: null });
}

/**
 * The project a section's new chats start in: its linked project, else its chat folder.
 * `available` is false when that project was deleted or archived.
 */
export function sidebarSectionChatProject<
  P extends { readonly workspaceRoot: string; readonly archivedAt?: string | null | undefined },
>(section: CustomSidebarSection, findProject: (ref: ScopedProjectRef) => P | null) {
  const key = section.projectKey ?? section.chatProjectKey;
  if (key === undefined) return null;
  const mode: SidebarSectionFolderMode = section.projectKey !== undefined ? "link" : "chat";
  const ref = parseScopedProjectKey(key);
  const project = ref === null ? null : findProject(ref);
  return {
    ref,
    project,
    mode,
    available: ref !== null && project !== null && project.archivedAt == null,
  };
}

export function moveThreadsToSidebarSection(
  sections: readonly CustomSidebarSection[],
  threadKeys: readonly string[],
  destination: string | null,
) {
  if (
    threadKeys.length === 0 ||
    (destination !== null && !sections.some((section) => section.id === destination))
  ) {
    return sections;
  }
  const moving = new Set(threadKeys);
  return sections.map((section) => {
    if (section.id === destination) {
      return { ...section, threadKeys: [...new Set([...section.threadKeys, ...moving])] };
    }
    const remaining = section.threadKeys.filter((key) => !moving.has(key));
    if (destination === null && section.projectKey !== undefined) {
      return {
        ...section,
        threadKeys: remaining,
        excludedThreadKeys: [...new Set([...(section.excludedThreadKeys ?? []), ...moving])],
      };
    }
    return remaining.length === section.threadKeys.length
      ? section
      : { ...section, threadKeys: remaining };
  });
}

export type SidebarSectionIndex = ReturnType<typeof indexSidebarSections>;

export function useStartSidebarSectionChat(handleNewThread: NewThreadHandler) {
  const gt = useGT();
  const { openScratchProject, scratchEnvironmentId } = useScratchProject();
  return async (section: CustomSidebarSection, fallback: ScopedProjectRef | null) => {
    let workspace = fallback;
    const target = sidebarSectionChatProject(section, readProject);
    if (target !== null) {
      if (!target.available || target.ref === null) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: gt("Could not start a chat in this section"),
            description: target.project
              ? gt("The folder “{folder}” no longer exists as a project.", {
                  folder: target.project.workspaceRoot,
                })
              : gt("This section's folder no longer exists as a project."),
          }),
        );
        openSectionFolderDialog(section.id, target.mode);
        return;
      }
      workspace = target.ref;
    } else {
      const scratch = scratchEnvironmentId(fallback?.environmentId ?? null);
      if (scratch !== null) {
        const project = await openScratchProject(scratch);
        if (project === null) return;
        workspace = scopeProjectRef(project.environmentId, project.id);
      }
    }
    if (workspace === null) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Could not start a chat in this section"),
          description: gt("Choose an available project folder for this section."),
        }),
      );
      return;
    }
    const draft = await handleNewThread(workspace);
    if (draft === null) return;
    const key = scopedThreadKey(scopeThreadRef(workspace.environmentId, draft.threadId));
    setSidebarSections((current) =>
      moveThreadsToSidebarSection(current, [key], section.id).map((item) =>
        item.id === section.id && item.collapsed ? { ...item, collapsed: false } : item,
      ),
    );
  };
}

// A section can contain settled threads that the initial server snapshot omits.
export function useSidebarSectionThreads(
  sections: readonly CustomSidebarSection[],
  connectedEnvironmentIds: readonly EnvironmentId[],
) {
  const connected = new Set(connectedEnvironmentIds);
  const observed = JSON.stringify(
    sections
      .flatMap((section) => section.threadKeys)
      .filter((key) => {
        const ref = parseScopedThreadKey(key);
        return ref !== null && connected.has(ref.environmentId);
      })
      .sort(),
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to server thread shells while assigned to a local section
  useEffect(() => {
    const releases = (JSON.parse(observed) as string[]).flatMap((key) => {
      const ref = parseScopedThreadKey(key);
      if (ref === null) return [];
      const atom = environmentThreadShells.threadShellAtom(ref);
      let releaseFamily: (() => void) | undefined;
      let loading = false;
      const loadMissing = () => {
        if (!loading && appAtomRegistry.get(atom) === null) {
          loading = true;
          releaseFamily = threadFamilies.mount(appAtomRegistry, ref.environmentId, ref.threadId);
        }
      };
      const unsubscribe = appAtomRegistry.subscribe(atom, loadMissing);
      loadMissing();
      return [
        () => {
          unsubscribe();
          releaseFamily?.();
        },
      ];
    });
    return () => {
      for (const release of releases) release();
    };
  }, [observed]);
}

const NO_THREADS: readonly EnvironmentThreadShell[] = [];

function threadShellKey(thread: Pick<EnvironmentThreadShell, "environmentId" | "id">) {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

function routeThreadOnly(
  threads: readonly EnvironmentThreadShell[],
  routeThreadKey: string | null,
): readonly EnvironmentThreadShell[] {
  if (routeThreadKey === null) return NO_THREADS;
  const routeThread = threads.find((thread) => threadShellKey(thread) === routeThreadKey);
  return routeThread === undefined ? NO_THREADS : [routeThread];
}

/**
 * Takes the threads of custom sections out of the built-in shelves. `useSidebarThreads`
 * spreads the result last, so it replaces the shelf lists, keys and search list there.
 */
export function splitCustomSidebarSections(
  partition: Readonly<Record<`${SidebarSection}Threads`, readonly EnvironmentThreadShell[]>>,
  sectionIndex: SidebarSectionIndex,
  routeRowThreadKey: string | null,
) {
  const sectionsByStatus = [
    [partition.pinnedThreads, "pinned"],
    [partition.activeThreads, "active"],
    [partition.workingThreads, "working"],
    [partition.snoozedThreads, "snoozed"],
    [partition.settledThreads, "settled"],
  ] as const;
  const searchableThreads = sectionsByStatus.flatMap(([threads]) => threads);
  const sectionIdByThread = new Map<string, string>();
  const sectionThreads = new Map<string, EnvironmentThreadShell[]>();
  const sectionByThreadKey = new Map<string, SidebarSection>();
  for (const [threads, status] of sectionsByStatus) {
    for (const thread of threads) {
      const key = threadShellKey(thread);
      sectionByThreadKey.set(key, status);
      const sectionId = sectionIndex.forThread(thread.environmentId, thread.id, thread.projectId);
      if (sectionId !== null) {
        sectionIdByThread.set(key, sectionId);
        const group = sectionThreads.get(sectionId);
        if (group) group.push(thread);
        else sectionThreads.set(sectionId, [thread]);
      }
    }
  }
  const unassigned = (threads: readonly EnvironmentThreadShell[]) =>
    sectionIdByThread.size === 0
      ? threads
      : threads.filter((thread) => !sectionIdByThread.has(threadShellKey(thread)));
  const groups = sectionIndex.sections.map((section) => {
    const threads = orderItemsByPreferredIds({
      items: sectionThreads.get(section.id) ?? NO_THREADS,
      preferredIds: section.threadKeys,
      getId: threadShellKey,
    });
    return {
      section,
      count: threads.length,
      threads: section.collapsed ? routeThreadOnly(threads, routeRowThreadKey) : threads,
    };
  });
  return {
    pinnedThreads: unassigned(partition.pinnedThreads),
    activeThreads: unassigned(partition.activeThreads),
    workingThreads: unassigned(partition.workingThreads),
    snoozedThreads: unassigned(partition.snoozedThreads),
    settledThreads: unassigned(partition.settledThreads),
    searchableThreads,
    sectionByThreadKey,
    settledThreadKeys: new Set(partition.settledThreads.map(threadShellKey)),
    snoozedThreadKeys: new Set(partition.snoozedThreads.map(threadShellKey)),
    customSectionThreads: {
      groups,
      sectionIdByThread,
      sectionByThreadKey,
      renderedThreadKeys: new Set(groups.flatMap(({ threads }) => threads.map(threadShellKey))),
      layoutKey: JSON.stringify(
        groups.map(({ section, threads }) => [section.id, threads.map(threadShellKey)]),
      ),
    },
  };
}

export type CustomSectionThreads = ReturnType<
  typeof splitCustomSidebarSections
>["customSectionThreads"];

// With sections every row can drag (into one); rows inside a section take no shelf drop.
const SECTION_ROW_DRAG_ENABLED = { draggable: false } as const;
const SECTION_ROW_DRAG_DISABLED = { draggable: true } as const;
const SECTION_MEMBER_DRAG_ENABLED = { draggable: false, droppable: true } as const;
const SECTION_MEMBER_DRAG_DISABLED = { draggable: true, droppable: true } as const;

export type SidebarSectionDragRole = "row" | "member";

export function sectionSortableDisabled(role: SidebarSectionDragRole, sortableDisabled: boolean) {
  if (role === "member") {
    return sortableDisabled ? SECTION_MEMBER_DRAG_DISABLED : SECTION_MEMBER_DRAG_ENABLED;
  }
  return sortableDisabled ? SECTION_ROW_DRAG_DISABLED : SECTION_ROW_DRAG_ENABLED;
}

// The section whose header, or one of whose rows, is under the pointer.
export function customSectionAtPoint(
  list: HTMLElement | null,
  point: { readonly x: number; readonly y: number },
  sectionIdByThread: ReadonlyMap<string, string>,
) {
  if (list === null) return null;
  for (const element of list.ownerDocument.elementsFromPoint(point.x, point.y)) {
    const header = element.closest<HTMLElement>("[data-sidebar-section-drop]");
    if (header && list.contains(header)) return header.dataset.sidebarSectionDrop ?? null;
    const row = element.closest<HTMLElement>("[data-thread-item]");
    const sectionId =
      row && list.contains(row) ? sectionIdByThread.get(row.dataset.threadItem ?? "") : undefined;
    if (sectionId !== undefined) return sectionId;
  }
  return null;
}
