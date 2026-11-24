import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ScheduledTaskId,
  ThreadId,
  type ScheduledTask,
  type ScheduledTaskOrganization,
  type ScheduledTaskRun,
  type ScheduledTaskRunsResult,
} from "@t3tools/contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../../test/render";
import { __setClientSettingsForTests, getClientSettings } from "../../hooks/useSettings";
import { assistantCitationFromLocation } from "../../lib/assistantCitationNavigation";
import { ScheduledWorkspace } from "./ScheduledWorkspace";
import { ScheduledSidebarGroup, SCHEDULED_SIDEBAR_COLLAPSED_KEY } from "./ScheduledSidebarGroup";
import { SCHEDULED_RUNS_PANEL_OPEN_KEY, ScheduledThreadPanel } from "./ScheduledThreadPanel";
import { scheduledTaskOrganizationKey } from "./scheduledTaskOrganization";
import { validateScheduledWorkspaceSearch } from "./scheduledWorkspaceSearch";
import { SidebarProvider } from "../ui/sidebar";

const environmentId = EnvironmentId.make("local");
const task: ScheduledTask = {
  id: ScheduledTaskId.make("daily-brief"),
  title: "Daily briefing",
  prompt: "Collect the results",
  enabled: false,
  schedule: { type: "fixed_time", timeOfDay: "09:00" },
  projectId: ProjectId.make("project"),
  threadId: null,
  workspaceStrategy: { type: "root" },
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
  runtimeMode: "auto",
  interactionMode: "default",
  createdBy: "user",
  creationSource: "web",
  createdAt: "2026-11-20T09:00:00.000Z",
  updatedAt: "2026-11-20T09:00:00.000Z",
  nextRunAt: null,
  lastRunAt: "2026-11-20T09:00:00.000Z",
  lastRunStatus: "succeeded",
  lastRunError: null,
  runCount: 2,
};
const taskKey = scheduledTaskOrganizationKey(environmentId, task.id);
const environment = { environmentId, label: "Local" };
const resultAtom = Atom.make<AsyncResult.AsyncResult<ScheduledTaskRunsResult, never>>(
  AsyncResult.initial(),
);
// The server answers a thread lookup with the task's runs when one of them went to that thread.
const threadLookupAtom = Atom.family((threadId: string) =>
  Atom.make((get): AsyncResult.AsyncResult<ScheduledTaskRunsResult, never> => {
    const result = get(resultAtom);
    if (result._tag !== "Success") return result;
    return result.value.runs.some((run) => run.threadId === threadId)
      ? result
      : AsyncResult.success({ taskId: null, runs: [] });
  }),
);
const tasksAtom = Atom.make<readonly ScheduledTask[]>([task]);
const permitted = Atom.make(true);
const commandSpy = vi.hoisted(() => vi.fn<(label: string, input: unknown) => void>());
const threadMessages = vi.hoisted(
  () => new Map<string, readonly { id: string; role: "assistant"; text: string }[]>(),
);

vi.mock(import("./useScheduledWorkspaceTasks"), () => ({
  useScheduledWorkspaceTasks: () => {
    const tasks = useAtomValue(tasksAtom);
    return {
      rows: tasks.map((item) => ({ environmentId, timeZone: undefined, task: item })),
      sources: [{ environment, data: { tasks }, error: null }],
      environmentCount: 1,
      isReady: true,
    };
  },
}));
vi.mock(import("../../state/server"), async (original) => {
  const module = await original();
  const permitted_ = { permissionAtom: () => permitted };
  return {
    ...module,
    serverEnvironment: {
      ...module.serverEnvironment,
      scheduledTaskRunsLive: ({ input }: { input: { id: string } | { threadId: string } }) =>
        "threadId" in input ? threadLookupAtom(input.threadId) : resultAtom,
      upsertScheduledTask: { ...module.serverEnvironment.upsertScheduledTask, ...permitted_ },
      setScheduledTaskEnabled: {
        ...module.serverEnvironment.setScheduledTaskEnabled,
        ...permitted_,
      },
      deleteScheduledTask: { ...module.serverEnvironment.deleteScheduledTask, ...permitted_ },
    },
  } as never;
});
vi.mock(import("../../state/threads"), async (original) => ({
  ...(await original()),
  useEnvironmentThread: (_environmentId, threadId) =>
    ({
      data:
        threadId === null
          ? Option.none()
          : Option.some({ thread: {}, messages: threadMessages.get(threadId) ?? [] }),
      status: "live",
      error: Option.none(),
      history: { hasMoreHistory: false, loading: false, error: null },
      sequence: 1,
    }) as never,
}));
vi.mock(import("../../state/use-atom-command"), () => ({
  useAtomCommand: ((command: { readonly label: string }) => async (value: { input: unknown }) => {
    commandSpy(command.label, value.input);
    return { _tag: "Success", value: {} };
  }) as never,
}));
vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useProject: () => null,
}));

function run(name: string, requestedAt: string, threadId: string): ScheduledTaskRun {
  return {
    runId: RunId.make(name),
    threadId: ThreadId.make(threadId),
    userMessageId: MessageId.make(name + "-user"),
    assistantMessageId: MessageId.make(name + "-reply"),
    status: "completed",
    requestedAt,
  };
}

const older = run("first", "2026-11-19T09:00:00.000Z", "thread-a");
const latest = run("second", "2026-11-20T09:00:00.000Z", "thread-b");
const sharedOlder = run("first", "2026-11-19T09:00:00.000Z", "shared-thread");
const sharedLatest = run("second", "2026-11-20T09:00:00.000Z", "shared-thread");

function createWorkspaceRouter(initialEntry: string) {
  const root = createRootRoute({ component: Outlet });
  const chat = createRoute({
    id: "_chat",
    getParentRoute: () => root,
    component: () => (
      <>
        <aside>
          <ScheduledSidebarGroup />
          <Link to="/">Chats</Link>
        </aside>
        <Outlet />
      </>
    ),
  });
  const index = createRoute({
    path: "/",
    getParentRoute: () => chat,
    component: () => <p>Chat view</p>,
  });
  const scheduled = createRoute({
    path: "/scheduled",
    getParentRoute: () => chat,
    validateSearch: validateScheduledWorkspaceSearch,
    component: ScheduledWorkspace,
  });
  // Mirrors the `_chat` layout: the thread's chat with the runs panel beside it.
  const thread = createRoute({
    path: "/$environmentId/$threadId",
    getParentRoute: () => chat,
    component: function ThreadView() {
      const params = thread.useParams();
      return (
        <>
          <p>Chat for {params.threadId}</p>
          <ScheduledThreadPanel
            threadRef={scopeThreadRef(
              EnvironmentId.make(params.environmentId),
              ThreadId.make(params.threadId),
            )}
          />
        </>
      );
    },
  });
  return createRouter({
    routeTree: root.addChildren([chat.addChildren([index, scheduled, thread])]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
    disableGlobalCatchBoundary: true,
  });
}

async function viewport(width: number) {
  const previous = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(width, 800);
  return { [Symbol.asyncDispose]: () => page.viewport(previous.width, previous.height) };
}

function isolateLocalStorage(...keys: string[]) {
  const previous = keys.map((key) => [key, localStorage.getItem(key)] as const);
  for (const key of keys) localStorage.removeItem(key);
  return {
    [Symbol.dispose]() {
      for (const [key, value] of previous) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
    },
  };
}

function withOrganization(patch: Partial<ScheduledTaskOrganization> = {}) {
  const previousSettings = getClientSettings();
  __setClientSettingsForTests({
    ...previousSettings,
    scheduledTaskOrganization: {
      pinnedTaskKeys: [],
      sections: [],
      collapsedGroups: [],
      lastSeenAt: { [taskKey]: "2026-11-21T00:00:00.000Z" },
      ...patch,
    },
  });
  return { [Symbol.dispose]: () => __setClientSettingsForTests(previousSettings) };
}

/** Shared per-test state: a registry holding the runs and the task list. */
function createFixture(
  options: {
    runs?: readonly ScheduledTaskRun[];
    task?: ScheduledTask;
    initialEntry?: string;
  } = {},
) {
  const registry = AtomRegistry.make();
  const unmountRuns = registry.mount(resultAtom);
  const unmountTasks = registry.mount(tasksAtom);
  registry.set(
    resultAtom,
    AsyncResult.success({ taskId: task.id, runs: options.runs ?? [latest, older] }),
  );
  registry.set(tasksAtom, [options.task ?? task]);
  commandSpy.mockReset();
  threadMessages.clear();
  return {
    registry,
    router: createWorkspaceRouter(options.initialEntry ?? "/"),
    [Symbol.dispose]() {
      unmountRuns();
      unmountTasks();
    },
  };
}

function renderWorkspace(fixture: ReturnType<typeof createFixture>) {
  return render(
    <RegistryContext.Provider value={fixture.registry}>
      <SidebarProvider>
        <RouterProvider router={fixture.router} />
      </SidebarProvider>
    </RegistryContext.Provider>,
    { router: false },
  );
}

async function openTask(screen: Awaited<ReturnType<typeof renderWorkspace>>, name: RegExp) {
  await userEvent.click(screen.getByRole("button", { name: "Scheduled", exact: true }));
  await userEvent.click(screen.getByRole("link", { name }));
}

const runButtons = (screen: Awaited<ReturnType<typeof renderWorkspace>>) =>
  screen.getByRole("complementary", { name: "Runs" }).getByRole("button", { name: /Completed/ });

describe("Scheduled task chats", () => {
  it("opens a task in its latest run's chat with the runs beside it and switches runs there", async () => {
    await using _viewport = await viewport(1280);
    using _storage = isolateLocalStorage(
      SCHEDULED_SIDEBAR_COLLAPSED_KEY,
      SCHEDULED_RUNS_PANEL_OPEN_KEY,
    );
    using _organization = withOrganization();
    using fixture = createFixture();
    const { router } = fixture;
    await using screen = await renderWorkspace(fixture);
    await openTask(screen, /^Daily briefing/);

    await expect.element(screen.getByText("Chat for thread-b")).toBeVisible();
    expect(router.state.location.pathname).toBe("/local/thread-b");
    const panel = screen.getByRole("complementary", { name: "Runs" });
    await expect.element(panel.getByRole("heading", { name: "Daily briefing" })).toBeVisible();
    await expect.element(panel.getByText(/^Daily at/)).toBeVisible();
    for (const name of ["Edit", "Resume", "Delete", "Details"]) {
      await expect.element(panel.getByRole("button", { name, exact: true })).toBeVisible();
    }
    expect(runButtons(screen).elements()).toHaveLength(2);
    await expect.element(runButtons(screen).first()).toHaveAttribute("aria-current", "true");
    await expect
      .element(screen.getByRole("link", { name: /^Daily briefing/ }))
      .toHaveAttribute("aria-current", "page");

    await userEvent.click(panel.getByRole("button", { name: "Details" }));
    await expect.element(panel.getByText("Collect the results")).toBeVisible();

    await userEvent.click(runButtons(screen).last());
    await expect.element(screen.getByText("Chat for thread-a")).toBeVisible();
    expect(router.state.location.pathname).toBe("/local/thread-a");
    await expect.element(runButtons(screen).last()).toHaveAttribute("aria-current", "true");
    await expect
      .element(screen.getByRole("link", { name: /^Daily briefing/ }))
      .toHaveAttribute("aria-current", "page");
  });

  it("lands on the latest run's reply in a shared thread and scrolls to another run's reply", async () => {
    await using _viewport = await viewport(1280);
    using _storage = isolateLocalStorage(
      SCHEDULED_SIDEBAR_COLLAPSED_KEY,
      SCHEDULED_RUNS_PANEL_OPEN_KEY,
    );
    using _organization = withOrganization();
    using fixture = createFixture({
      runs: [sharedLatest, sharedOlder],
      task: { ...task, threadId: ThreadId.make("shared-thread"), threadMode: "continue" },
    });
    threadMessages.set("shared-thread", [
      {
        id: "first-reply",
        role: "assistant",
        text: "## Monday\n\nThree tickets are waiting today.",
      },
      {
        id: "second-reply",
        role: "assistant",
        text: "**Tuesday:** all clear in the support queue.",
      },
    ]);
    const { router } = fixture;
    await using screen = await renderWorkspace(fixture);
    await openTask(screen, /^Daily briefing/);

    await expect.element(screen.getByText("Chat for shared-thread")).toBeVisible();
    await vi.waitFor(() =>
      expect(assistantCitationFromLocation(router.state.location.href)).toMatchObject({
        threadId: "shared-thread",
        messageId: "second-reply",
        text: "all clear in the support queue",
      }),
    );
    await expect.element(runButtons(screen).first()).toHaveAttribute("aria-current", "true");

    await userEvent.click(runButtons(screen).last());
    await vi.waitFor(() =>
      expect(assistantCitationFromLocation(router.state.location.href)).toMatchObject({
        messageId: "first-reply",
        text: "Three tickets are waiting today",
      }),
    );
    expect(router.state.location.pathname).toBe("/local/shared-thread");
    await expect.element(runButtons(screen).last()).toHaveAttribute("aria-current", "true");
  });

  it("highlights the task while its run's chat is open from anywhere, and only then", async () => {
    await using _viewport = await viewport(1280);
    using _storage = isolateLocalStorage(
      SCHEDULED_SIDEBAR_COLLAPSED_KEY,
      SCHEDULED_RUNS_PANEL_OPEN_KEY,
    );
    using _organization = withOrganization();
    using fixture = createFixture({ initialEntry: "/local/thread-a" });
    await using screen = await renderWorkspace(fixture);
    await expect.element(screen.getByText("Chat for thread-a")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Scheduled", exact: true }));
    const link = screen.getByRole("link", { name: /^Daily briefing/ });
    await expect.element(link).toHaveAttribute("aria-current", "page");
    await expect.element(runButtons(screen).last()).toHaveAttribute("aria-current", "true");

    await act(() =>
      fixture.router.navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId: "unrelated" },
      }),
    );
    await expect.element(screen.getByText("Chat for unrelated")).toBeVisible();
    await expect.element(link).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("complementary", { name: "Runs" }).elements()).toHaveLength(0);
  });

  it("hides the runs panel and brings it back", async () => {
    await using _viewport = await viewport(1280);
    using _storage = isolateLocalStorage(
      SCHEDULED_SIDEBAR_COLLAPSED_KEY,
      SCHEDULED_RUNS_PANEL_OPEN_KEY,
    );
    using _organization = withOrganization();
    using fixture = createFixture({ initialEntry: "/local/thread-b" });
    await using screen = await renderWorkspace(fixture);
    await userEvent.click(screen.getByRole("button", { name: "Hide runs" }));
    await expect
      .element(screen.getByRole("complementary", { name: "Runs" }))
      .not.toBeInTheDocument();
    expect(localStorage.getItem(SCHEDULED_RUNS_PANEL_OPEN_KEY)).toBe("false");

    await userEvent.click(screen.getByRole("button", { name: "Show runs" }));
    await expect.element(screen.getByRole("complementary", { name: "Runs" })).toBeVisible();
    await expect.element(screen.getByText("Chat for thread-b")).toBeVisible();
  });

  it("opens the task page for a task that has not run yet", async () => {
    await using _viewport = await viewport(1280);
    using _storage = isolateLocalStorage(SCHEDULED_SIDEBAR_COLLAPSED_KEY);
    using _organization = withOrganization();
    using fixture = createFixture({
      runs: [],
      task: { ...task, lastRunAt: null, lastRunStatus: "never", runCount: 0 },
    });
    await using screen = await renderWorkspace(fixture);
    await openTask(screen, /^Daily briefing/);
    expect(fixture.router.state.location.pathname).toBe("/scheduled");
    await expect.element(screen.getByRole("heading", { name: "Daily briefing" })).toBeVisible();
    await expect.element(screen.getByText("Collect the results")).toBeVisible();
    const history = screen.getByRole("complementary", { name: "Runs" });
    await expect.element(history.getByText("No runs yet")).toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: /^Daily briefing/ }))
      .toHaveAttribute("aria-current", "page");
  });

  it("deletes a task from its menu after confirmation, keeps the chat and clears what was stored for it", async () => {
    await using _viewport = await viewport(1280);
    using _storage = isolateLocalStorage(SCHEDULED_SIDEBAR_COLLAPSED_KEY);
    using _organization = withOrganization({
      pinnedTaskKeys: [taskKey, "other"],
      sections: [{ id: "s", name: "Support", collapsed: false, taskKeys: [taskKey] }],
      lastSeenAt: { [taskKey]: "2026-11-21T00:00:00.000Z", other: "2026-11-21T00:00:00.000Z" },
    });
    using fixture = createFixture();
    commandSpy.mockImplementation((label) => {
      if (label.endsWith(":delete")) fixture.registry.set(tasksAtom, []);
    });
    await using screen = await renderWorkspace(fixture);
    await openTask(screen, /^Daily briefing/);
    await expect.element(screen.getByText("Chat for thread-b")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Options for Daily briefing" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Delete" }));
    await expect
      .element(page.getByRole("alertdialog").getByText(/Delete "Daily briefing"\?/))
      .toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Cancel" }));
    await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
    expect(commandSpy).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Options for Daily briefing" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Delete" }));
    await userEvent.click(page.getByRole("button", { name: "Delete task" }));
    await vi.waitFor(() =>
      expect(commandSpy).toHaveBeenCalledWith("environment-data:server:scheduled-task:delete", {
        id: task.id,
      }),
    );
    await vi.waitFor(() => {
      const organization = getClientSettings().scheduledTaskOrganization;
      expect(organization.pinnedTaskKeys).toEqual(["other"]);
      expect(organization.sections[0]?.taskKeys).toEqual([]);
      expect(Object.keys(organization.lastSeenAt)).toEqual(["other"]);
    });
    expect(fixture.router.state.location.pathname).toBe("/local/thread-b");
    await expect
      .element(screen.getByRole("complementary", { name: "Runs" }))
      .not.toBeInTheDocument();
  });

  it("deletes the task from the runs panel", async () => {
    await using _viewport = await viewport(1280);
    using _storage = isolateLocalStorage(
      SCHEDULED_SIDEBAR_COLLAPSED_KEY,
      SCHEDULED_RUNS_PANEL_OPEN_KEY,
    );
    using _organization = withOrganization();
    using fixture = createFixture({ initialEntry: "/local/thread-b" });
    await using screen = await renderWorkspace(fixture);
    const panel = screen.getByRole("complementary", { name: "Runs" });
    await userEvent.click(panel.getByRole("button", { name: "Delete", exact: true }));
    await userEvent.click(page.getByRole("button", { name: "Delete task" }));
    await vi.waitFor(() =>
      expect(commandSpy).toHaveBeenCalledWith("environment-data:server:scheduled-task:delete", {
        id: task.id,
      }),
    );
  });

  it("pauses and resumes a task from its menu and from the runs panel", async () => {
    await using _viewport = await viewport(1280);
    using _storage = isolateLocalStorage(
      SCHEDULED_SIDEBAR_COLLAPSED_KEY,
      SCHEDULED_RUNS_PANEL_OPEN_KEY,
    );
    using _organization = withOrganization();
    using fixture = createFixture({ task: { ...task, enabled: true } });
    await using screen = await renderWorkspace(fixture);
    await userEvent.click(screen.getByRole("button", { name: "Scheduled", exact: true }));
    await userEvent.click(screen.getByRole("button", { name: "Options for Daily briefing" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Pause" }));
    await vi.waitFor(() =>
      expect(commandSpy).toHaveBeenCalledWith(
        "environment-data:server:scheduled-task:set-enabled",
        { id: task.id, enabled: false },
      ),
    );

    await act(() => fixture.registry.set(tasksAtom, [{ ...task, enabled: false }]));
    await userEvent.click(screen.getByRole("button", { name: "Options for Daily briefing" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Resume" }));
    await vi.waitFor(() =>
      expect(commandSpy).toHaveBeenLastCalledWith(
        "environment-data:server:scheduled-task:set-enabled",
        { id: task.id, enabled: true },
      ),
    );

    await userEvent.click(screen.getByRole("link", { name: /^Daily briefing/ }));
    const panel = screen.getByRole("complementary", { name: "Runs" });
    await userEvent.click(panel.getByRole("button", { name: "Resume", exact: true }));
    await vi.waitFor(() => expect(commandSpy).toHaveBeenCalledTimes(3));
    expect(commandSpy).toHaveBeenLastCalledWith(
      "environment-data:server:scheduled-task:set-enabled",
      { id: task.id, enabled: true },
    );
  });

  it("offers Edit in the menu and no Pause for a completed one-time task", async () => {
    using _storage = isolateLocalStorage(SCHEDULED_SIDEBAR_COLLAPSED_KEY);
    using _organization = withOrganization({ pinnedTaskKeys: [taskKey] });
    using fixture = createFixture({
      task: { ...task, schedule: { type: "once", runAt: "2026-11-20T09:00:00.000Z" } },
    });
    await using screen = await renderWorkspace(fixture);
    await userEvent.click(screen.getByRole("button", { name: "Scheduled", exact: true }));
    await userEvent.click(screen.getByRole("button", { name: "Options for Daily briefing" }));
    await expect.element(page.getByRole("menuitem", { name: "Edit" })).toBeVisible();
    await expect.element(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
    await expect.element(page.getByRole("menuitem", { name: "Pause" })).not.toBeInTheDocument();
    await expect.element(page.getByRole("menuitem", { name: "Resume" })).not.toBeInTheDocument();
  });

  it("collapses the sidebar groups and remembers it in the client settings", async () => {
    using _organization = withOrganization({ collapsedGroups: ["completed"] });
    using _storage = isolateLocalStorage(SCHEDULED_SIDEBAR_COLLAPSED_KEY);
    using fixture = createFixture();
    await using screen = await renderWorkspace(fixture);
    await userEvent.click(screen.getByRole("button", { name: "Scheduled", exact: true }));
    const allTasks = screen.getByRole("button", { name: /^All tasks/ });
    await expect.element(allTasks).toHaveAttribute("aria-expanded", "true");
    await expect.element(screen.getByRole("link", { name: "Daily briefing Paused" })).toBeVisible();

    await userEvent.click(allTasks);
    await expect.element(allTasks).toHaveAttribute("aria-expanded", "false");
    await expect.element(screen.getByRole("button", { name: "All tasks 1" })).toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "Daily briefing Paused" }))
      .not.toBeInTheDocument();
    await vi.waitFor(() =>
      expect(getClientSettings().scheduledTaskOrganization.collapsedGroups).toEqual([
        "completed",
        "all",
      ]),
    );

    await userEvent.click(allTasks);
    await expect.element(allTasks).toHaveAttribute("aria-expanded", "true");
    await vi.waitFor(() =>
      expect(getClientSettings().scheduledTaskOrganization.collapsedGroups).toEqual(["completed"]),
    );
  });

  it("moves a task into a subsection, pins it and keeps both choices when reopening Scheduled", async () => {
    using _organization = withOrganization();
    using _storage = isolateLocalStorage(SCHEDULED_SIDEBAR_COLLAPSED_KEY);
    using fixture = createFixture();
    await using screen = await renderWorkspace(fixture);
    await userEvent.click(screen.getByRole("button", { name: "Scheduled", exact: true }));
    await userEvent.click(screen.getByRole("button", { name: "New subsection" }));
    await userEvent.fill(page.getByRole("textbox", { name: "Subsection name" }), "Support");
    await userEvent.click(page.getByRole("button", { name: "Create subsection" }));
    await userEvent.click(screen.getByRole("button", { name: "Options for Daily briefing" }));
    await userEvent.hover(page.getByRole("menuitem", { name: "Move to subsection" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Support" }));
    await expect
      .element(screen.getByRole("heading", { name: "All tasks" }))
      .not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Options for Daily briefing" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Pin task" }));
    await expect.element(screen.getByRole("heading", { name: "Pinned" })).toBeVisible();
    const group = screen.getByRole("button", { name: "Scheduled", exact: true });
    await userEvent.click(group);
    await expect.element(screen.getByRole("heading", { name: "Pinned" })).not.toBeInTheDocument();
    await userEvent.click(group);
    await expect.element(screen.getByRole("heading", { name: "Pinned" })).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Options for Daily briefing" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Unpin task" }));
    await userEvent.click(screen.getByRole("button", { name: "Support", exact: true }));
    await expect
      .element(screen.getByRole("link", { name: "Daily briefing Paused" }))
      .not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Support/ }).first());
    await expect.element(screen.getByRole("link", { name: "Daily briefing Paused" })).toBeVisible();
  });

  it("keeps a pinned task, its state and its menu in the sidebar while Scheduled is collapsed", async () => {
    await using _viewport = await viewport(1280);
    using _storage = isolateLocalStorage(
      SCHEDULED_SIDEBAR_COLLAPSED_KEY,
      SCHEDULED_RUNS_PANEL_OPEN_KEY,
    );
    const other: ScheduledTask = { ...task, id: ScheduledTaskId.make("other"), title: "Weekly" };
    using _organization = withOrganization({ pinnedTaskKeys: [taskKey], lastSeenAt: {} });
    using fixture = createFixture({ task: { ...task, enabled: true } });
    await act(() =>
      fixture.registry.set(tasksAtom, [
        { ...task, enabled: true, lastRunStatus: "running" },
        other,
      ]),
    );
    await using screen = await renderWorkspace(fixture);
    const header = screen.getByRole("button", { name: "Scheduled", exact: true });
    await expect.element(header).toHaveAttribute("aria-expanded", "false");
    const pinned = screen.getByRole("link", { name: /^Daily briefing/ });
    await expect.element(pinned).toBeVisible();
    expect(pinned.element().querySelector(".border-info")).not.toBeNull();
    await expect.element(screen.getByRole("link", { name: /^Weekly/ })).not.toBeInTheDocument();
    // Only the hidden task flags the collapsed header.
    expect(header.element().querySelector("[data-unread]")).not.toBeNull();

    await act(() => fixture.registry.set(tasksAtom, [{ ...task, enabled: true }]));
    await vi.waitFor(() => expect(pinned.element().querySelector("[data-unread]")).not.toBeNull());
    expect(header.element().querySelector("[data-unread]")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Options for Daily briefing" }));
    await expect.element(page.getByRole("menuitem", { name: "Unpin task" })).toBeVisible();
    await userEvent.keyboard("{Escape}");

    await userEvent.click(pinned);
    await expect.element(screen.getByText("Chat for thread-b")).toBeVisible();
    await expect.element(pinned).toHaveAttribute("aria-current", "page");
    await vi.waitFor(() => expect(pinned.element().querySelector("[data-unread]")).toBeNull());
    await expect.element(header).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Scheduled unread results", () => {
  const unreadDot = (link: { element: () => Element }) =>
    link.element().querySelector("[data-unread]");
  const unseen = { lastSeenAt: {} };

  it("marks a new result unread, reads it when the latest run's chat is opened and unreads it after the next one", async () => {
    await using _viewport = await viewport(1280);
    using _storage = isolateLocalStorage(SCHEDULED_SIDEBAR_COLLAPSED_KEY);
    using _organization = withOrganization(unseen);
    using fixture = createFixture();
    await using screen = await renderWorkspace(fixture);
    await userEvent.click(screen.getByRole("button", { name: "Scheduled", exact: true }));
    const link = screen.getByRole("link", { name: /^Daily briefing/ });
    await expect.element(link).toBeVisible();
    expect(unreadDot(link)).not.toBeNull();
    expect(getClientSettings().scheduledTaskOrganization.lastSeenAt).toEqual({});

    await userEvent.click(link);
    await expect.element(screen.getByText("Chat for thread-b")).toBeVisible();
    await vi.waitFor(() => expect(unreadDot(link)).toBeNull());
    expect(Object.keys(getClientSettings().scheduledTaskOrganization.lastSeenAt)).toEqual([
      taskKey,
    ]);

    await userEvent.click(screen.getByRole("link", { name: "Chats" }));
    await act(() =>
      fixture.registry.set(tasksAtom, [{ ...task, lastRunAt: "2030-01-01T00:00:00.000Z" }]),
    );
    await vi.waitFor(() => expect(unreadDot(link)).not.toBeNull());
  });

  it("keeps a result unread while an older run's chat is open", async () => {
    await using _viewport = await viewport(1280);
    using _storage = isolateLocalStorage(SCHEDULED_SIDEBAR_COLLAPSED_KEY);
    using _organization = withOrganization(unseen);
    using fixture = createFixture({ initialEntry: "/local/thread-a" });
    await using screen = await renderWorkspace(fixture);
    await expect.element(screen.getByText("Chat for thread-a")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Scheduled", exact: true }));
    await expect
      .element(screen.getByRole("link", { name: /^Daily briefing/ }))
      .toHaveAttribute("aria-current", "page");
    expect(unreadDot(screen.getByRole("link", { name: /^Daily briefing/ }))).not.toBeNull();
    expect(getClientSettings().scheduledTaskOrganization.lastSeenAt).toEqual({});
  });

  it("marks a task read and unread from its menu", async () => {
    using _storage = isolateLocalStorage(SCHEDULED_SIDEBAR_COLLAPSED_KEY);
    using _organization = withOrganization(unseen);
    using fixture = createFixture();
    await using screen = await renderWorkspace(fixture);
    await userEvent.click(screen.getByRole("button", { name: "Scheduled", exact: true }));
    const link = screen.getByRole("link", { name: /^Daily briefing/ });
    expect(unreadDot(link)).not.toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Options for Daily briefing" }));
    await expect
      .element(page.getByRole("menuitem", { name: "Mark as unread" }))
      .not.toBeInTheDocument();
    await userEvent.click(page.getByRole("menuitem", { name: "Mark as read" }));
    await vi.waitFor(() => expect(unreadDot(link)).toBeNull());

    await userEvent.click(screen.getByRole("button", { name: "Options for Daily briefing" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Mark as unread" }));
    await vi.waitFor(() => expect(unreadDot(link)).not.toBeNull());
    expect(getClientSettings().scheduledTaskOrganization.lastSeenAt).toEqual({});
  });

  it("labels a read failure and drops the label while it is unread", async () => {
    using _storage = isolateLocalStorage(SCHEDULED_SIDEBAR_COLLAPSED_KEY);
    using _organization = withOrganization();
    using fixture = createFixture({
      task: { ...task, enabled: true, lastRunStatus: "failed" },
    });
    await using screen = await renderWorkspace(fixture);
    await userEvent.click(screen.getByRole("button", { name: "Scheduled", exact: true }));
    const read = screen.getByRole("link", { name: "Daily briefing Failed" });
    await expect.element(read).toBeVisible();
    expect(unreadDot(read)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Options for Daily briefing" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Mark as unread" }));
    const unread = screen.getByRole("link", { name: "Daily briefing", exact: true });
    await expect.element(unread).toBeVisible();
    expect(unreadDot(unread)?.firstElementChild?.className).toContain("bg-destructive");
  });

  it("counts unread tasks in a collapsed group and flags a collapsed Scheduled header", async () => {
    using _storage = isolateLocalStorage(SCHEDULED_SIDEBAR_COLLAPSED_KEY);
    using _organization = withOrganization({ ...unseen, collapsedGroups: [] });
    using fixture = createFixture();
    await using screen = await renderWorkspace(fixture);
    const header = screen.getByRole("button", { name: "Scheduled", exact: true });
    expect(header.element().querySelector("[data-unread]")).not.toBeNull();
    await userEvent.click(header);
    expect(header.element().querySelector("[data-unread]")).toBeNull();

    const allTasks = screen.getByRole("button", { name: /^All tasks/ });
    await userEvent.click(allTasks);
    await expect.element(allTasks).toHaveTextContent("All tasks11");
    await userEvent.click(screen.getByRole("button", { name: "Scheduled", exact: true }));
    await expect.element(header).toBeVisible();
    expect(header.element().querySelector("[data-unread]")).not.toBeNull();
  });
});
