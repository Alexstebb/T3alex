import * as Schema from "effect/Schema";
import { useEffect } from "react";
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
  const setSections = (
    value:
      | readonly SidebarCustomSection[]
      | ((current: readonly SidebarCustomSection[]) => readonly SidebarCustomSection[]),
  ) => {
    const next =
      typeof value === "function" ? value(getClientSettings().sidebarCustomSections) : value;
    void persistClientSettingsPatch({ sidebarCustomSections: next });
  };
  return [sections, setSections] as const;
}

export function sidebarSectionRowId(id: string) {
  return `custom-section:${id}`;
}

export function indexSidebarSections(sections: readonly CustomSidebarSection[]) {
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
    linked,
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

export function useStartSidebarSectionChat(
  handleNewThread: NewThreadHandler,
  setSections: ReturnType<typeof useSidebarSections>[1],
) {
  const gt = useGT();
  const { openScratchProject, scratchEnvironmentId } = useScratchProject();
  return async (section: CustomSidebarSection, fallback: ScopedProjectRef | null) => {
    let workspace = fallback;
    if (section.projectKey !== undefined) {
      const linked = parseScopedProjectKey(section.projectKey);
      const project = linked === null ? null : readProject(linked);
      workspace = project && project.archivedAt == null ? linked : null;
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
    setSections((current) =>
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
