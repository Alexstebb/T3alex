import {
  scopedProjectKey,
  scopeProjectRef,
  scopedThreadKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture } from "../../test-fixtures";
import type { Thread } from "../../types";
import { resolveSidebarFolderDot } from "../Sidebar.logic";
import {
  resolveSectionLamp,
  resolveSidebarSectionLamp,
  resumableLimitedThreads,
  resumeAtResetTarget,
  sectionLampToneOfThread,
} from "./sidebarSectionLamp.logic";
import {
  indexSidebarSections,
  splitCustomSidebarSections,
  type CustomSidebarSection,
} from "./sidebarSections";

const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("claude");
const runtime = {
  status: "running" as const,
  activeRunId: null,
  providerInstanceId: ProviderInstanceId.make("claudeAgent"),
  providerName: "Claude",
  lastError: null,
  updatedAt: "2026-11-26T10:00:00.000Z",
};
const latestRun = (status: "completed" | "failed" = "completed") => ({
  runId: RunId.make("run-1"),
  status,
  assistantMessageId: null,
  requestedAt: "2026-11-26T10:00:00.000Z",
  startedAt: "2026-11-26T10:00:00.000Z",
  completedAt: "2026-11-26T10:05:00.000Z",
});
const SEEN = "2026-11-26T10:06:00.000Z";
const BEFORE = "2026-11-26T10:04:00.000Z";

/** One thread in each state a sidebar row can show. */
const states = {
  quiet: { latestRun: latestRun(), lastVisitedAt: SEEN, runtime: null },
  approval: {
    latestRun: latestRun(),
    lastVisitedAt: SEEN,
    runtime: null,
    hasPendingApprovals: true,
  },
  input: { latestRun: latestRun(), lastVisitedAt: SEEN, runtime: null, hasPendingUserInput: true },
  request: {
    latestRun: latestRun(),
    lastVisitedAt: SEEN,
    runtime: null,
    pendingGuestMessageCount: 1,
  },
  limited: {
    latestRun: latestRun("failed"),
    lastVisitedAt: BEFORE,
    runtime: { ...runtime, status: "failed" as const, lastErrorClass: "usage_limit" as const },
  },
  failed: {
    latestRun: latestRun("failed"),
    lastVisitedAt: BEFORE,
    runtime: { ...runtime, status: "failed" as const },
  },
  done: { latestRun: latestRun(), lastVisitedAt: BEFORE, runtime: null },
  working: { latestRun: latestRun(), lastVisitedAt: SEEN, runtime },
  // Waiting on the user's next message after a reply: the row says Waiting, not Done.
  waiting: {
    latestRun: latestRun(),
    lastVisitedAt: BEFORE,
    runtime: { ...runtime, status: "idle" as const },
  },
} satisfies Record<string, Partial<Thread>>;

const thread = (id: string, state: keyof typeof states, project = projectId) =>
  makeThreadFixture({
    environmentId,
    id: ThreadId.make(id),
    projectId: project,
    title: id,
    ...states[state],
  });

const keyOf = (item: Thread) => scopedThreadKey(scopeThreadRef(item.environmentId, item.id));

describe("sectionLampToneOfThread", () => {
  it("gives each thread the state its row shows, and nothing for quiet or waiting rows", () => {
    expect(
      Object.fromEntries(
        Object.keys(states).map((state) => [
          state,
          sectionLampToneOfThread(thread(state, state as keyof typeof states)),
        ]),
      ),
    ).toEqual({
      quiet: null,
      approval: "approval",
      input: "input",
      request: "request",
      limited: "limited",
      failed: "failed",
      done: "done",
      working: "working",
      waiting: null,
    });
  });
});

describe("resolveSidebarSectionLamp", () => {
  it("shows the most urgent state: approval and input first, then failure and unread, then working", () => {
    const lamp = (...names: (keyof typeof states)[]) =>
      resolveSidebarSectionLamp(names.map((name, index) => thread(`t${index}`, name)))?.tone ??
      null;
    expect(lamp("quiet", "waiting")).toBeNull();
    expect(lamp("quiet", "working")).toBe("working");
    expect(lamp("working", "done")).toBe("done");
    expect(lamp("done", "failed")).toBe("failed");
    expect(lamp("failed", "limited")).toBe("limited");
    expect(lamp("limited", "request", "done")).toBe("request");
    expect(lamp("request", "input", "working")).toBe("input");
    expect(lamp("input", "approval")).toBe("approval");
  });

  it("counts the chats that need the user, but not working ones", () => {
    const threads = [
      thread("a", "input"),
      thread("b", "done"),
      thread("c", "done"),
      thread("d", "working"),
      thread("e", "quiet"),
    ];
    expect(resolveSidebarSectionLamp(threads)).toEqual({
      tone: "input",
      waiting: 3,
      counts: { input: 1, done: 2, working: 1 },
    });
    expect(resolveSidebarSectionLamp([thread("w", "working")])).toMatchObject({
      tone: "working",
      waiting: 0,
    });
  });

  it("agrees with upstream's closed-folder dot on which kind of state wins", () => {
    const coarse = {
      approval: "attention",
      input: "attention",
      request: "attention",
      limited: "attention",
      failed: "failed",
      done: "unread",
      working: "working",
    } as const;
    const names = Object.keys(states) as (keyof typeof states)[];
    for (const first of names) {
      for (const second of names) {
        const threads = [thread("x", first), thread("y", second)];
        const tone = resolveSidebarSectionLamp(threads)?.tone;
        expect(tone === undefined ? null : coarse[tone]).toBe(resolveSidebarFolderDot(threads));
      }
    }
  });

  it("resolves an empty count to no lamp", () => {
    expect(resolveSectionLamp({})).toBeNull();
    expect(resolveSectionLamp({ done: 0 })).toBeNull();
  });
});

describe("collapsed sections of every kind", () => {
  const linkedProject = ProjectId.make("t3");
  const partitionOf = (threads: readonly Thread[]) => ({
    pinnedThreads: [],
    activeThreads: threads,
    workingThreads: [],
    snoozedThreads: [],
    settledThreads: [],
  });
  const lampsOf = (
    sections: readonly CustomSidebarSection[],
    threads: readonly Thread[],
    routeRowThreadKey: string | null = null,
  ) =>
    Object.fromEntries(
      splitCustomSidebarSections(
        partitionOf(threads),
        indexSidebarSections(sections),
        routeRowThreadKey,
      ).customSectionThreads.groups.map((group) => [
        group.section.name,
        resolveSidebarSectionLamp(group.hiddenThreads)?.tone ?? null,
      ]),
    );

  it("lights a chat-folder section holding its chats by key, like Faste agenter", () => {
    const waiting = thread("standing-agent", "input");
    const others = Array.from({ length: 7 }, (_, index) => thread(`agent-${index}`, "quiet"));
    const fasteAgenter: CustomSidebarSection = {
      id: "faste",
      name: "Faste agenter",
      collapsed: true,
      chatProjectKey: scopedProjectKey(scopeProjectRef(environmentId, projectId)),
      threadKeys: [...others, waiting].map(keyOf),
    };
    expect(lampsOf([fasteAgenter], [...others, waiting])).toEqual({ "Faste agenter": "input" });
  });

  it("lights plain and linked sections, and keeps open sections and quiet ones dark", () => {
    const sections: CustomSidebarSection[] = [
      { id: "plain", name: "Kunder", collapsed: true, threadKeys: [keyOf(thread("p", "done"))] },
      {
        id: "linked",
        name: "T3 og verktøy",
        collapsed: true,
        threadKeys: [],
        projectKey: scopedProjectKey(scopeProjectRef(environmentId, linkedProject)),
      },
      { id: "open", name: "Open", collapsed: false, threadKeys: [keyOf(thread("o", "input"))] },
      { id: "quiet", name: "Privat", collapsed: true, threadKeys: [keyOf(thread("q", "quiet"))] },
    ];
    const threads = [
      thread("p", "done"),
      thread("l", "approval", linkedProject),
      thread("o", "input"),
      thread("q", "quiet"),
    ];
    expect(lampsOf(sections, threads)).toEqual({
      Kunder: "done",
      "T3 og verktøy": "approval",
      Open: null,
      Privat: null,
    });
  });

  it("leaves out the open chat's row, which a closed section still shows", () => {
    const open = thread("open", "failed");
    const section: CustomSidebarSection = {
      id: "s",
      name: "Codex",
      collapsed: true,
      threadKeys: [keyOf(open), keyOf(thread("other", "working"))],
    };
    expect(lampsOf([section], [open, thread("other", "working")], keyOf(open))).toEqual({
      Codex: "working",
    });
  });
});

describe("resume at reset", () => {
  const RESET_AT = "2026-11-26T15:00:00.000Z";
  const limitedThread = (id: string, overrides: Partial<Thread> = {}) =>
    makeThreadFixture({
      environmentId,
      id: ThreadId.make(id),
      projectId,
      title: id,
      ...states.limited,
      runtime: { ...states.limited.runtime, usageLimitResetAt: RESET_AT },
      ...overrides,
    });
  const scheduled = {
    limitRecovery: { runId: RunId.make("run-1"), resetAt: RESET_AT, autoResume: true },
  };

  it("offers the action for a limited chat with a known reset time", () => {
    expect(resumeAtResetTarget(limitedThread("a"))).toEqual({
      runId: RunId.make("run-1"),
      resetAt: RESET_AT,
    });
  });

  it("offers nothing when the reset time is unknown, the chat is settled, a request waits, or it is not limited", () => {
    expect(resumeAtResetTarget(thread("b", "limited"))).toBeNull();
    expect(resumeAtResetTarget(limitedThread("c", { settledOverride: "settled" }))).toBeNull();
    expect(resumeAtResetTarget(limitedThread("d", { hasPendingApprovals: true }))).toBeNull();
    expect(resumeAtResetTarget(thread("e", "failed"))).toBeNull();
    expect(
      resumeAtResetTarget(
        limitedThread("f", {
          runtime: { ...states.limited.runtime, usageLimitResetAt: BEFORE },
        }),
      ),
    ).toBeNull();
  });

  it("drops a chat with auto-resume on from the lamp and from the action", () => {
    const resuming = limitedThread("g", scheduled);
    expect(resumeAtResetTarget(resuming)).toBeNull();
    expect(sectionLampToneOfThread(resuming)).toBeNull();
    expect(resolveSidebarSectionLamp([resuming, thread("h", "done")])).toEqual({
      tone: "done",
      waiting: 1,
      counts: { done: 1 },
    });
    // Auto-resume for an older run or reset does not count.
    const stale = limitedThread("i", {
      limitRecovery: { ...scheduled.limitRecovery, resetAt: BEFORE },
    });
    expect(sectionLampToneOfThread(stale)).toBe("limited");
  });

  it("bulk action picks only limited chats it can schedule", () => {
    const threads = [
      limitedThread("a"),
      limitedThread("b", scheduled),
      thread("c", "limited"),
      thread("d", "failed"),
      limitedThread("e"),
    ];
    expect(resumableLimitedThreads(threads).map((item) => item.title)).toEqual(["a", "e"]);
  });
});
