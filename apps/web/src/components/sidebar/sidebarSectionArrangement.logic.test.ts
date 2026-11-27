import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture } from "../../test-fixtures";
import type { Thread } from "../../types";
import {
  arrangeSectionThreads,
  hidesScheduledRun,
  SECTION_INITIAL_ROW_COUNT,
} from "./sidebarSectionArrangement.logic";
import type { SectionLampTone } from "./sidebarSectionLamp.logic";
import {
  indexSidebarSections,
  splitCustomSidebarSections,
  type CustomSidebarSection,
} from "./sidebarSections";

interface Row {
  readonly key: string;
  readonly tone: SectionLampTone | null;
  readonly pinned?: boolean;
}

const row = (key: string, tone: SectionLampTone | null = null, pinned = false): Row => ({
  key,
  tone,
  pinned,
});
const quiet = (count: number, prefix = "q") =>
  Array.from({ length: count }, (_, index) => row(`${prefix}${index}`));

const arrange = (
  threads: readonly Row[],
  limit = SECTION_INITIAL_ROW_COUNT,
  route = null as string | null,
) =>
  arrangeSectionThreads({
    threads,
    keyOf: (item) => item.key,
    toneOf: (item) => item.tone,
    isPinned: (item) => item.pinned === true,
    routeThreadKey: route,
    limit,
  });
const keys = (result: ReturnType<typeof arrange>) => result.threads.map((item) => item.key);

describe("arrangeSectionThreads", () => {
  it("floats chats that need the user up in the lamp's order and keeps the rest in place", () => {
    const result = arrange([
      row("a"),
      row("done", "done"),
      row("b"),
      row("work", "working"),
      row("input", "input"),
      row("fail", "failed"),
      row("approve", "approval"),
      row("limit", "limited"),
      row("guest", "request"),
      row("c"),
    ]);
    expect(keys(result)).toEqual([
      "approve",
      "input",
      "guest",
      "limit",
      "fail",
      "done",
      "a",
      "b",
      "work",
      "c",
    ]);
  });

  it("keeps equal states in their stored order", () => {
    expect(keys(arrange([row("x", "done"), row("a"), row("y", "done")]))).toEqual(["x", "y", "a"]);
  });

  it("leaves pinned chats first, as pins lead elsewhere", () => {
    expect(keys(arrange([row("a"), row("ask", "input"), row("pin", null, true)]))).toEqual([
      "pin",
      "ask",
      "a",
    ]);
  });

  it("shows ten rows and folds the rest", () => {
    const result = arrange(quiet(30));
    expect(result.threads).toHaveLength(10);
    expect(result.foldedCount).toBe(20);
    expect(arrange(quiet(30), 35).foldedCount).toBe(0);
    expect(arrange(quiet(10)).foldedCount).toBe(0);
  });

  it("still shows the open chat and every chat that needs the user past the limit", () => {
    const threads = [
      ...quiet(12),
      row("late-ask", "input"),
      ...quiet(5, "r"),
      row("late-done", "done"),
    ];
    const result = arrange(threads, SECTION_INITIAL_ROW_COUNT, "r3");
    expect(keys(result).slice(0, 2)).toEqual(["late-ask", "late-done"]);
    expect(keys(result)).toContain("r3");
    expect(result.threads).toHaveLength(11);
    expect(result.foldedCount).toBe(threads.length - 11);
  });

  it("keeps a working chat in its place, where the limit can fold it", () => {
    const threads = [...quiet(10), row("busy", "working")];
    expect(keys(arrange(threads))).not.toContain("busy");
  });
});

describe("hidesScheduledRun", () => {
  const base = {
    threadKey: "local:run",
    scheduledRunThreadKeys: new Set(["local:run"]),
    placedByHand: false,
    pinned: false,
    routeThreadKey: null,
  };
  it("hides a scheduled run's chat", () => {
    expect(hidesScheduledRun(base)).toBe(true);
  });
  it("keeps the user's own chats", () => {
    expect(hidesScheduledRun({ ...base, threadKey: "local:mine" })).toBe(false);
  });
  it("keeps a run placed in the section by hand, a pinned run and the open chat", () => {
    expect(hidesScheduledRun({ ...base, placedByHand: true })).toBe(false);
    expect(hidesScheduledRun({ ...base, pinned: true })).toBe(false);
    expect(hidesScheduledRun({ ...base, routeThreadKey: "local:run" })).toBe(false);
  });
});

describe("splitCustomSidebarSections with scheduled runs and a long section", () => {
  const environmentId = EnvironmentId.make("local");
  const projectId = ProjectId.make("claude");
  const completed = {
    runId: RunId.make("run"),
    status: "completed" as const,
    assistantMessageId: null,
    requestedAt: "2026-11-26T10:00:00.000Z",
    startedAt: "2026-11-26T10:00:00.000Z",
    completedAt: "2026-11-26T10:05:00.000Z",
  };
  const chat = (id: string, patch: Partial<Thread> = {}) =>
    makeThreadFixture({
      environmentId,
      id: ThreadId.make(id),
      projectId,
      title: id,
      latestRun: completed,
      lastVisitedAt: "2026-11-26T10:06:00.000Z",
      runtime: null,
      ...patch,
    });
  const key = (id: string) => `local:${id}`;
  const linked = (patch: Partial<CustomSidebarSection> = {}): CustomSidebarSection => ({
    id: "claude",
    name: "Claude",
    collapsed: false,
    threadKeys: [],
    projectKey: scopedProjectKey(scopeProjectRef(environmentId, projectId)),
    ...patch,
  });
  const split = (
    section: CustomSidebarSection,
    threads: readonly Thread[],
    runs: readonly string[],
    route: string | null = null,
  ) =>
    splitCustomSidebarSections(
      {
        pinnedThreads: threads.filter((item) => item.pinnedAt != null),
        activeThreads: threads.filter((item) => item.pinnedAt == null),
        workingThreads: [],
        snoozedThreads: [],
        settledThreads: [],
      },
      indexSidebarSections([section], {
        scheduledRunThreadKeys: new Set(runs.map(key)),
        toneOf: (item) =>
          item.hasPendingUserInput ? "input" : item.lastVisitedAt === null ? "done" : null,
        rowLimit: () => SECTION_INITIAL_ROW_COUNT,
      }),
      route,
    );
  const ids = (result: ReturnType<typeof split>) =>
    result.customSectionThreads.groups[0]!.threads.map((item) => item.id as string);

  it("leaves scheduled runs out of a linked section, but keeps them out of the shelves too", () => {
    const threads = [chat("mine"), chat("run-1"), chat("run-2")];
    const result = split(linked(), threads, ["run-1", "run-2"]);
    expect(ids(result)).toEqual(["mine"]);
    expect(result.activeThreads).toEqual([]);
    expect(result.customSectionThreads.renderedThreadKeys).toEqual(new Set([key("mine")]));
  });

  it("keeps a run placed by hand, a pinned run and the open run", () => {
    const threads = [
      chat("by-hand"),
      chat("pinned", { pinnedAt: "2026-11-26T09:00:00.000Z" }),
      chat("open"),
      chat("other"),
    ];
    const result = split(
      linked({ threadKeys: [key("by-hand")] }),
      threads,
      ["by-hand", "pinned", "open", "other"],
      key("open"),
    );
    expect(ids(result).toSorted()).toEqual(["by-hand", "open", "pinned"]);
  });

  it("does not let hidden runs light a closed section or count as folded rows", () => {
    const waitingRun = chat("run", { hasPendingUserInput: true });
    const closed = split(linked({ collapsed: true }), [chat("mine"), waitingRun], ["run"]);
    expect(closed.customSectionThreads.groups[0]!.lamp).toBeNull();

    const many = [
      ...Array.from({ length: 12 }, (_, i) => chat(`own${i}`)),
      ...Array.from({ length: 20 }, (_, i) => chat(`run${i}`)),
    ];
    const open = split(
      linked(),
      many,
      Array.from({ length: 20 }, (_, i) => `run${i}`),
    );
    expect(open.customSectionThreads.groups[0]!.foldedCount).toBe(2);
  });

  it("lists pinned chats first, then the rest newest activity first", () => {
    const at = (minute: number) => ({
      latestUserMessageAt: `2026-11-27T10:${String(minute).padStart(2, "0")}:00.000Z`,
      latestRun: null,
    });
    const threads = [
      chat("old", at(1)),
      chat("pin", { ...at(0), pinnedAt: "2026-11-26T09:00:00.000Z" }),
      chat("newest", at(30)),
      chat("middle", at(10)),
    ];
    const result = split(linked({ threadKeys: [key("old"), key("middle")] }), threads, []);
    expect(ids(result)).toEqual(["pin", "newest", "middle", "old"]);
  });

  it("puts a chat that needs the user on top, even from past the limit", () => {
    const threads = [
      ...Array.from({ length: 14 }, (_, i) => chat(`own${i}`)),
      chat("asks", { hasPendingUserInput: true }),
    ];
    const result = split(linked(), threads, []);
    expect(ids(result)[0]).toBe("asks");
    expect(ids(result)).toHaveLength(10);
    expect(result.customSectionThreads.groups[0]!.foldedCount).toBe(5);
  });
});
