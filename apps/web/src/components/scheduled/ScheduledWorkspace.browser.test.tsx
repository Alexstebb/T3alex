import { RegistryContext, useAtomValue } from "@effect/atom-react";
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
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../../test/render";
import { __setClientSettingsForTests, getClientSettings } from "../../hooks/useSettings";
import { ScheduledWorkspace } from "./ScheduledWorkspace";
import { ScheduledSidebarGroup, SCHEDULED_SIDEBAR_COLLAPSED_KEY } from "./ScheduledSidebarGroup";
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
const tasksAtom = Atom.make<readonly ScheduledTask[]>([task]);
const permitted = Atom.make(true);
const readWorkspaceTasks = vi.hoisted(() => vi.fn());
const commandSpy = vi.hoisted(() => vi.fn<(label: string, input: unknown) => void>());

vi.mock(import("./useScheduledWorkspaceTasks"), () => ({
  useScheduledWorkspaceTasks: () => {
    readWorkspaceTasks();
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
      scheduledTaskRunsLive: () => resultAtom,
      upsertScheduledTask: { ...module.serverEnvironment.upsertScheduledTask, ...permitted_ },
      setScheduledTaskEnabled: {
        ...module.serverEnvironment.setScheduledTaskEnabled,
        ...permitted_,
      },
      deleteScheduledTask: { ...module.serverEnvironment.deleteScheduledTask, ...permitted_ },
    },
  };
});
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
vi.mock(import("./ScheduledRunOutput"), () => ({
  ScheduledRunOutput: ({ run }) => <p>Output for {run.runId}</p>,
}));

function run(name: string, requestedAt: string): ScheduledTaskRun {
  return {
    runId: RunId.make(name),
    threadId: ThreadId.make("shared-thread"),
    userMessageId: MessageId.make(name + "-user"),
    assistantMessageId: null,
    status: "completed",
    requestedAt,
  };
}

const older = run("first", "2026-11-19T09:00:00.000Z");
const latest = run("second", "2026-11-20T09:00:00.000Z");
const next = run("third", "2026-11-21T09:00:00.000Z");

function createWorkspaceRouter() {
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
  return createRouter({
    routeTree: root.addChildren([chat.addChildren([index, scheduled])]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
    disableGlobalCatchBoundary: true,
  });
}

async function viewport(width: number) {
  const previous = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(width, 800);
  return { [Symbol.asyncDispose]: () => page.viewport(previous.width, previous.height) };
}

function isolateLocalStorage(key: string) {
  const previous = localStorage.getItem(key);
  localStorage.removeItem(key);
  return {
    [Symbol.dispose]() {
      if (previous === null) localStorage.removeItem(key);
      else localStorage.setItem(key, previous);
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
function createFixture(options: { runs?: readonly ScheduledTaskRun[]; task?: ScheduledTask } = {}) {
  const registry = AtomRegistry.make();
  const unmountRuns = registry.mount(resultAtom);
  const unmountTasks = registry.mount(tasksAtom);
  registry.set(resultAtom, AsyncResult.success({ runs: options.runs ?? [latest, older] }));
  registry.set(tasksAtom, [options.task ?? task]);
  commandSpy.mockReset();
  readWorkspaceTasks.mockClear();
  return {
    registry,
    router: createWorkspaceRouter(),
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

describe("Scheduled workspace", () => {
  it("opens a task on its latest run, lists every run beside it and keeps an older pick when new runs arrive", async () => {
    await using _viewport = await viewport(1280);
    using _collapse = isolateLocalStorage(SCHEDULED_SIDEBAR_COLLAPSED_KEY);
    using _organization = withOrganization();
    using fixture = createFixture();
    const { registry, router } = fixture;
    await using screen = await renderWorkspace(fixture);
    const group = screen.getByRole("button", { name: "Scheduled", exact: true });
    await expect.element(group).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(group);
    await expect.element(group).toHaveAttribute("aria-expanded", "true");
    expect(router.state.location.pathname).toBe("/");
    const originalGroup = group.element();
    await userEvent.click(screen.getByRole("link", { name: "Daily briefing Paused" }));

    await expect.element(screen.getByText("Output for second")).toBeVisible();
    expect(router.state.location.search).not.toHaveProperty("runId");
    expect(group.element()).toBe(originalGroup);
    const history = screen.getByRole("complementary", { name: "Runs" });
    await expect.element(history.getByRole("heading", { name: "Runs" })).toBeVisible();
    expect(history.getByRole("button", { name: /Completed/ }).elements()).toHaveLength(2);
    await expect
      .element(history.getByRole("button", { name: /Completed/ }).first())
      .toHaveAttribute("aria-current", "true");
    await expect.element(screen.getByRole("heading", { name: "Daily briefing" })).toBeVisible();
    for (const name of ["Edit", "Delete", "Details"]) {
      await expect.element(screen.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await expect.element(screen.getByText("Back to runs")).not.toBeInTheDocument();

    await userEvent.click(history.getByRole("button", { name: /Completed/ }).last());
    await expect.element(screen.getByText("Output for first")).toBeVisible();
    expect(router.state.location.search).toMatchObject({ runId: "first" });
    await act(() => registry.set(resultAtom, AsyncResult.success({ runs: [next, latest, older] })));
    await expect.element(screen.getByText("Output for first")).toBeVisible();
    await vi.waitFor(() =>
      expect(history.getByRole("button", { name: /Completed/ }).elements()).toHaveLength(3),
    );

    await userEvent.click(history.getByRole("button", { name: /Completed/ }).first());
    await expect.element(screen.getByText("Output for third")).toBeVisible();
    expect(router.state.location.search).not.toHaveProperty("runId");
  });

  it("follows new runs while the latest one is open", async () => {
    await using _viewport = await viewport(1280);
    using _collapse = isolateLocalStorage(SCHEDULED_SIDEBAR_COLLAPSED_KEY);
    using _organization = withOrganization();
    using fixture = createFixture();
    await using screen = await renderWorkspace(fixture);
    await openTask(screen, /^Daily briefing/);
    await expect.element(screen.getByText("Output for second")).toBeVisible();
    await act(() =>
      fixture.registry.set(resultAtom, AsyncResult.success({ runs: [next, latest, older] })),
    );
    await expect.element(screen.getByText("Output for third")).toBeVisible();
    expect(fixture.router.state.location.search).not.toHaveProperty("runId");
  });

  it("shows the output with the runs folded above it on a narrow window", async () => {
    await using _viewport = await viewport(700);
    using _collapse = isolateLocalStorage(SCHEDULED_SIDEBAR_COLLAPSED_KEY);
    using _organization = withOrganization();
    using fixture = createFixture();
    await using screen = await renderWorkspace(fixture);
    await openTask(screen, /^Daily briefing/);
    await expect.element(screen.getByText("Output for second")).toBeVisible();
    const disclosure = screen.getByRole("button", { name: /^Runs/ });
    await expect.element(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(disclosure.element().textContent).toContain("Runs2");
    expect(screen.getByRole("complementary", { name: "Runs" }).elements()).toHaveLength(0);
    expect(screen.getByRole("button", { name: /Completed/ }).elements()).toHaveLength(0);

    await userEvent.click(disclosure);
    await expect.element(disclosure).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(screen.getByRole("button", { name: /Completed/ }).last());
    await expect.element(screen.getByText("Output for first")).toBeVisible();
    await expect.element(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(fixture.router.state.location.search).toMatchObject({ runId: "first" });
  });

  it("shows the header, an empty runs panel and the instructions when a task has no runs", async () => {
    await using _viewport = await viewport(1280);
    using _collapse = isolateLocalStorage(SCHEDULED_SIDEBAR_COLLAPSED_KEY);
    using _organization = withOrganization();
    using fixture = createFixture({
      runs: [],
      task: { ...task, lastRunAt: null, lastRunStatus: "never", runCount: 0 },
    });
    await using screen = await renderWorkspace(fixture);
    await openTask(screen, /^Daily briefing/);
    await expect.element(screen.getByRole("heading", { name: "Daily briefing" })).toBeVisible();
    await expect.element(screen.getByText("Collect the results")).toBeVisible();
    const history = screen.getByRole("complementary", { name: "Runs" });
    await expect.element(history.getByText("No runs yet")).toBeVisible();
    await expect.element(screen.getByText(/^Output for/)).not.toBeInTheDocument();
  });

  it("deletes a task from its menu after confirmation and clears what was stored for it", async () => {
    await using _viewport = await viewport(1280);
    using _collapse = isolateLocalStorage(SCHEDULED_SIDEBAR_COLLAPSED_KEY);
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
    await expect.element(screen.getByText("Output for second")).toBeVisible();

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
    await vi.waitFor(() => expect(fixture.router.state.location.search).toEqual({}));
    expect(fixture.router.state.location.pathname).toBe("/scheduled");
    await expect.element(screen.getByText("Select a scheduled task")).not.toBeInTheDocument();
    await vi.waitFor(() => {
      const organization = getClientSettings().scheduledTaskOrganization;
      expect(organization.pinnedTaskKeys).toEqual(["other"]);
      expect(organization.sections[0]?.taskKeys).toEqual([]);
      expect(Object.keys(organization.lastSeenAt)).toEqual(["other"]);
    });
  });

  it("deletes the open task from the page header", async () => {
    await using _viewport = await viewport(1280);
    using _collapse = isolateLocalStorage(SCHEDULED_SIDEBAR_COLLAPSED_KEY);
    using _organization = withOrganization();
    using fixture = createFixture();
    commandSpy.mockImplementation((label) => {
      if (label.endsWith(":delete")) fixture.registry.set(tasksAtom, []);
    });
    await using screen = await renderWorkspace(fixture);
    await openTask(screen, /^Daily briefing/);
    await userEvent.click(screen.getByRole("button", { name: "Delete", exact: true }));
    await userEvent.click(page.getByRole("button", { name: "Delete task" }));
    await vi.waitFor(() => expect(fixture.router.state.location.search).toEqual({}));
    expect(commandSpy).toHaveBeenCalledWith("environment-data:server:scheduled-task:delete", {
      id: task.id,
    });
  });

  it("pauses and resumes a task from its menu", async () => {
    using _collapse = isolateLocalStorage(SCHEDULED_SIDEBAR_COLLAPSED_KEY);
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
  });

  it("offers Edit in the menu and no Pause for a completed one-time task", async () => {
    using _collapse = isolateLocalStorage(SCHEDULED_SIDEBAR_COLLAPSED_KEY);
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
    using _collapse = isolateLocalStorage(SCHEDULED_SIDEBAR_COLLAPSED_KEY);
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
    using _collapse = isolateLocalStorage(SCHEDULED_SIDEBAR_COLLAPSED_KEY);
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
});

describe("Scheduled unread results", () => {
  const unreadDot = (link: { element: () => Element }) =>
    link.element().querySelector("[data-unread]");
  const unseen = { lastSeenAt: {} };

  it("marks a new result unread, reads it when the latest run is opened and unreads it after the next one", async () => {
    await using _viewport = await viewport(1280);
    using _collapse = isolateLocalStorage(SCHEDULED_SIDEBAR_COLLAPSED_KEY);
    using _organization = withOrganization(unseen);
    using fixture = createFixture();
    await using screen = await renderWorkspace(fixture);
    await userEvent.click(screen.getByRole("button", { name: "Scheduled", exact: true }));
    const link = screen.getByRole("link", { name: /^Daily briefing/ });
    await expect.element(link).toBeVisible();
    expect(unreadDot(link)).not.toBeNull();
    expect(getClientSettings().scheduledTaskOrganization.lastSeenAt).toEqual({});

    await userEvent.click(link);
    await expect.element(screen.getByText("Output for second")).toBeVisible();
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

  it("keeps a result unread while an older run is open", async () => {
    await using _viewport = await viewport(1280);
    using _collapse = isolateLocalStorage(SCHEDULED_SIDEBAR_COLLAPSED_KEY);
    using _organization = withOrganization(unseen);
    using fixture = createFixture();
    await fixture.router.navigate({
      to: "/scheduled",
      search: { environmentId, taskId: task.id, runId: older.runId },
    });
    await using screen = await renderWorkspace(fixture);
    await expect.element(screen.getByText("Output for first")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Scheduled", exact: true }));
    expect(unreadDot(screen.getByRole("link", { name: /^Daily briefing/ }))).not.toBeNull();
    expect(getClientSettings().scheduledTaskOrganization.lastSeenAt).toEqual({});
  });

  it("marks a task read and unread from its menu", async () => {
    using _collapse = isolateLocalStorage(SCHEDULED_SIDEBAR_COLLAPSED_KEY);
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
    using _collapse = isolateLocalStorage(SCHEDULED_SIDEBAR_COLLAPSED_KEY);
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
    using _collapse = isolateLocalStorage(SCHEDULED_SIDEBAR_COLLAPSED_KEY);
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
