import { RegistryContext } from "@effect/atom-react";
import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ScheduledTaskId,
  ThreadId,
  type ScheduledTask,
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
  lastRunAt: null,
  lastRunStatus: "succeeded",
  lastRunError: null,
  runCount: 2,
};
const row = { environmentId, timeZone: undefined, task };
const environment = { environmentId, label: "Local" };
const resultAtom = Atom.make<AsyncResult.AsyncResult<ScheduledTaskRunsResult, never>>(
  AsyncResult.initial(),
);
const permitted = Atom.make(true);
const readWorkspaceTasks = vi.hoisted(() => vi.fn());

vi.mock(import("./useScheduledWorkspaceTasks"), () => ({
  useScheduledWorkspaceTasks: () => {
    readWorkspaceTasks();
    return {
      rows: [row],
      sources: [{ environment, data: { tasks: [task] }, error: null }],
      environmentCount: 1,
      isReady: true,
    };
  },
}));
vi.mock(import("../../state/server"), async (original) => {
  const module = await original();
  return {
    ...module,
    serverEnvironment: {
      ...module.serverEnvironment,
      scheduledTaskRunsLive: () => resultAtom,
      upsertScheduledTask: {
        ...module.serverEnvironment.upsertScheduledTask,
        permissionAtom: () => permitted,
      },
    },
  };
});
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

async function wideViewport() {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(1280, 800);
  return { [Symbol.asyncDispose]: () => page.viewport(viewport.width, viewport.height) };
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

describe("Scheduled workspace", () => {
  it("opens a task on its run list, shows a run's output beside it and keeps that run when new ones arrive", async () => {
    readWorkspaceTasks.mockClear();
    await using _viewport = await wideViewport();
    using _collapse = isolateLocalStorage(SCHEDULED_SIDEBAR_COLLAPSED_KEY);
    const older = run("first", "2026-11-19T09:00:00.000Z");
    const latest = run("second", "2026-11-20T09:00:00.000Z");
    const next = run("third", "2026-11-21T09:00:00.000Z");
    const registry = AtomRegistry.make();
    using _history = { [Symbol.dispose]: registry.mount(resultAtom) };
    registry.set(resultAtom, AsyncResult.success({ runs: [latest, older] }));
    const router = createWorkspaceRouter();
    // Exercise the two real workspace route IDs with an isolated in-memory router.
    await using screen = await render(
      <RegistryContext.Provider value={registry}>
        <SidebarProvider>
          <RouterProvider router={router} />
        </SidebarProvider>
      </RegistryContext.Provider>,
      { router: false },
    );
    const group = screen.getByRole("button", { name: "Scheduled", exact: true });
    await expect.element(group).toHaveAttribute("aria-expanded", "false");
    expect(readWorkspaceTasks).not.toHaveBeenCalled();
    await expect
      .element(screen.getByRole("link", { name: "Daily briefing Paused" }))
      .not.toBeInTheDocument();
    await userEvent.click(group);
    await expect.element(group).toHaveAttribute("aria-expanded", "true");
    expect(readWorkspaceTasks).toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/");
    const originalGroup = group.element();
    await userEvent.click(screen.getByRole("link", { name: "Daily briefing Paused" }));

    const history = screen.getByRole("complementary", { name: "Runs" });
    await expect.element(history.getByRole("button", { name: /Completed/ }).first()).toBeVisible();
    await expect.element(screen.getByText(/^Output for/)).not.toBeInTheDocument();
    expect(router.state.location.search).not.toHaveProperty("runId");
    expect(group.element()).toBe(originalGroup);

    await userEvent.click(history.getByRole("button", { name: /Completed/ }).first());
    await expect.element(screen.getByText("Output for second")).toBeVisible();
    expect(router.state.location.search).toMatchObject({ runId: "second" });
    await userEvent.click(group);
    await expect
      .element(screen.getByRole("link", { name: "Daily briefing Paused" }))
      .not.toBeInTheDocument();
    await expect.element(screen.getByText("Output for second")).toBeVisible();
    await userEvent.click(group);

    await userEvent.click(history.getByRole("button", { name: /Completed/ }).last());
    await expect.element(screen.getByText("Output for first")).toBeVisible();
    await act(() => registry.set(resultAtom, AsyncResult.success({ runs: [next, latest, older] })));
    await expect.element(screen.getByText("Output for first")).toBeVisible();
    await vi.waitFor(() =>
      expect(history.getByRole("button", { name: /Completed/ }).elements()).toHaveLength(3),
    );

    await userEvent.click(screen.getByRole("link", { name: "Daily briefing Paused" }));
    await expect.element(screen.getByText(/^Output for/)).not.toBeInTheDocument();
    expect(router.state.location.search).not.toHaveProperty("runId");
  });

  it("collapses the sidebar groups and remembers it in the client settings", async () => {
    const previousSettings = getClientSettings();
    using _organization = {
      [Symbol.dispose]: () => __setClientSettingsForTests(previousSettings),
    };
    __setClientSettingsForTests({
      ...previousSettings,
      scheduledTaskOrganization: {
        pinnedTaskKeys: [],
        sections: [],
        collapsedGroups: ["completed"],
      },
    });
    using _collapse = isolateLocalStorage(SCHEDULED_SIDEBAR_COLLAPSED_KEY);
    const router = createWorkspaceRouter();
    await using screen = await render(
      <SidebarProvider>
        <RouterProvider router={router} />
      </SidebarProvider>,
      { router: false },
    );
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
    const previousSettings = getClientSettings();
    using _organization = {
      [Symbol.dispose]: () => __setClientSettingsForTests(previousSettings),
    };
    __setClientSettingsForTests({
      ...previousSettings,
      scheduledTaskOrganization: { pinnedTaskKeys: [], sections: [], collapsedGroups: [] },
    });
    using _collapse = isolateLocalStorage(SCHEDULED_SIDEBAR_COLLAPSED_KEY);
    const router = createWorkspaceRouter();
    // The workspace needs its actual route IDs for the sidebar search state.
    await using screen = await render(
      <SidebarProvider>
        <RouterProvider router={router} />
      </SidebarProvider>,
      { router: false },
    );
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
