import appCss from "../index.css?inline";
import {
  scopedProjectKey,
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type ScheduledTask,
  type ScheduledTaskId,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { __setClientSettingsForTests, getClientSettings } from "../hooks/useSettings";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import * as environmentHooks from "../state/environments";
import { useProjects, useQuietThreadShells } from "../state/entities";
import { makeThreadFixture } from "../test-fixtures";
import type { Project, Thread } from "../types";
import { useScheduledWorkspaceTasks } from "./scheduled/useScheduledWorkspaceTasks";
import Sidebar from "./Sidebar";
import { SidebarProvider } from "./ui/sidebar";

vi.mock("../state/entities", { spy: true });
vi.mock("../state/environments", { spy: true });
vi.mock("../hooks/useHandleNewThread", { spy: true });
vi.mock("../hooks/useThreadRouteTarget", { spy: true });
vi.mock("./scheduled/useScheduledWorkspaceTasks", { spy: true });
vi.mock("../commandPaletteBus", () => ({
  openCommandPalette: vi.fn(),
  isCommandPaletteOpen: () => false,
}));
vi.mock("./sidebar/SidebarChrome", () => ({
  SidebarChromeHeader: () => null,
  SidebarChromeFooter: () => null,
}));

const local = EnvironmentId.make("local");

function project(id: string): Project {
  return {
    id: ProjectId.make(id),
    environmentId: local,
    title: id,
    workspaceRoot: `/projects/${id}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
  };
}

const claude = project("claude");
const t3 = project("t3");
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
const states = {
  quiet: { latestRun: latestRun(), lastVisitedAt: SEEN, runtime: null },
  approval: {
    latestRun: latestRun(),
    lastVisitedAt: SEEN,
    runtime: null,
    hasPendingApprovals: true,
  },
  input: { latestRun: latestRun(), lastVisitedAt: SEEN, runtime: null, hasPendingUserInput: true },
  failed: {
    latestRun: latestRun("failed"),
    lastVisitedAt: BEFORE,
    runtime: { ...runtime, status: "failed" as const },
  },
  done: { latestRun: latestRun(), lastVisitedAt: BEFORE, runtime: null },
  working: { latestRun: latestRun(), lastVisitedAt: SEEN, runtime },
} satisfies Record<string, Partial<Thread>>;

const thread = (id: string, state: keyof typeof states, owner: Project = claude) =>
  makeThreadFixture({
    environmentId: local,
    id: ThreadId.make(id),
    projectId: owner.id,
    title: id,
    ...states[state],
  });
const keyOf = (item: Thread) => scopedThreadKey(scopeThreadRef(item.environmentId, item.id));

const fasteAgenter = [
  ...Array.from({ length: 7 }, (_, index) => thread(`agent-${index}`, "quiet")),
  thread("standing-agent", "input"),
];
const threads = [
  ...fasteAgenter,
  thread("customer-a", "done"),
  thread("customer-b", "done"),
  thread("film", "failed"),
  thread("film-2", "done"),
  thread("tool", "approval", t3),
  thread("tool-2", "input", t3),
  thread("tool-3", "working", t3),
  thread("codex", "working"),
  thread("private", "quiet"),
  thread("open-section", "input"),
];
const byId = new Map(threads.map((item) => [item.id as string, item]));
const keys = (...ids: string[]) => ids.map((id) => keyOf(byId.get(id)!));
const chatProjectKey = scopedProjectKey(scopeProjectRef(local, claude.id));

const sections = [
  {
    id: "faste",
    name: "Faste agenter",
    collapsed: true,
    chatProjectKey,
    threadKeys: fasteAgenter.map(keyOf),
  },
  {
    id: "kunder",
    name: "Kunder",
    collapsed: true,
    chatProjectKey,
    threadKeys: keys("customer-a", "customer-b"),
  },
  { id: "film", name: "Reklamefilm", collapsed: true, threadKeys: keys("film", "film-2") },
  {
    id: "tools",
    name: "T3 og verktøy",
    collapsed: true,
    threadKeys: [],
    projectKey: scopedProjectKey(scopeProjectRef(local, t3.id)),
  },
  { id: "codex", name: "Codex", collapsed: true, threadKeys: keys("codex") },
  { id: "privat", name: "Privat", collapsed: true, threadKeys: keys("private") },
  { id: "open", name: "Open section", collapsed: false, threadKeys: keys("open-section") },
];

const scheduledTask = (id: string, patch: Partial<ScheduledTask>) =>
  ({
    id: id as ScheduledTaskId,
    title: id,
    enabled: true,
    schedule: { type: "fixed_time", timeOfDay: "09:00" },
    nextRunAt: "2026-11-27T08:00:00.000Z",
    lastRunAt: "2026-11-26T08:00:00.000Z",
    lastRunStatus: "succeeded",
    runCount: 3,
    ...patch,
  }) as unknown as ScheduledTask;

async function renderSidebar() {
  const stack = new DisposableStack();
  vi.mocked(useProjects).mockReturnValue([claude, t3]);
  vi.mocked(useQuietThreadShells).mockReturnValue(threads);
  vi.mocked(useThreadRouteTarget).mockReturnValue(null);
  vi.mocked(useScheduledWorkspaceTasks).mockReturnValue({
    rows: [
      { environmentId: local, timeZone: "Europe/Oslo", task: scheduledTask("morning", {}) },
      {
        environmentId: local,
        timeZone: "Europe/Oslo",
        task: scheduledTask("backup", { lastRunStatus: "failed" }),
      },
    ],
    sources: [],
    environmentCount: 1,
    isReady: true,
  });
  stack.use(vi.spyOn(environmentHooks, "usePrimaryEnvironmentId").mockReturnValue(local));
  stack.use(vi.spyOn(environmentHooks, "useConnectedEnvironmentIds").mockReturnValue([local]));
  vi.mocked(useHandleNewThread).mockReturnValue({
    activeDraftThread: null,
    activeThread: null,
    defaultProjectRef: null,
    defaultProjectFallbackReady: true,
    handleNewThread: vi.fn().mockResolvedValue(null),
    routeDraftId: null,
    routeThreadRef: null,
  });
  const previousSettings = getClientSettings();
  stack.defer(() => __setClientSettingsForTests(previousSettings));
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    boringSidebarEnabled: false,
    sidebarCustomSections: sections,
  });
  const style = document.createElement("style");
  style.textContent = appCss;
  document.head.append(style);
  stack.defer(() => style.remove());
  const screen = await render(
    <SidebarProvider>
      <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
    </SidebarProvider>,
  );
  return {
    screen,
    async [Symbol.asyncDispose]() {
      await screen[Symbol.asyncDispose]();
      stack.dispose();
    },
  };
}

const lampOf = (sectionId: string) =>
  page.elementLocator(
    document.querySelector(`[data-sidebar-section-drop="${sectionId}"]`) ?? document.body,
  );

describe("closed section lamps", () => {
  it("lights each closed section with the most urgent state of its hidden chats", async () => {
    await page.viewport(1200, 900);
    await using _fixture = await renderSidebar();
    await expect
      .element(page.getByRole("img", { name: "1 chat is waiting for you, 1 needs your answer" }))
      .toBeVisible();

    const expected = {
      faste: { tone: "input", label: "1 chat is waiting for you, 1 needs your answer" },
      kunder: { tone: "done", label: "2 chats are waiting for you, 2 unread replies" },
      film: { tone: "failed", label: "2 chats are waiting for you, 1 failed, 1 unread reply" },
      tools: {
        tone: "approval",
        label: "2 chats are waiting for you, 1 needs approval, 1 needs your answer, 1 working",
      },
      codex: { tone: "working", label: "1 chat is working" },
    } as const;
    for (const [sectionId, { tone, label }] of Object.entries(expected)) {
      const lamp = lampOf(sectionId).getByRole("img", { name: label, exact: true });
      await expect.element(lamp).toHaveAttribute("data-section-lamp", tone);
    }
    // A count shows only when more than one chat needs the user.
    await expect.element(lampOf("faste").getByRole("img")).toHaveTextContent("");
    await expect.element(lampOf("kunder").getByRole("img")).toHaveTextContent("2");
    expect(document.querySelector('[data-sidebar-section-drop="privat"] [data-section-lamp]')).toBe(
      null,
    );
    expect(document.querySelector('[data-sidebar-section-drop="open"] [data-section-lamp]')).toBe(
      null,
    );

    // The Scheduled header lights for an unseen failed run, replacing the old yellow count.
    await expect
      .element(
        page
          .getByRole("img", { name: "2 chats are waiting for you, 1 failed, 1 unread reply" })
          .first(),
      )
      .toBeVisible();
    const scheduledLamp = page.getByRole("button", { name: /^Scheduled/ }).getByRole("img");
    await expect.element(scheduledLamp).toHaveAttribute("data-section-lamp", "failed");

    await userEvent.hover(lampOf("faste").getByRole("img"));
    await expect.element(page.getByText("1 needs your answer", { exact: true })).toBeVisible();
  });
});
