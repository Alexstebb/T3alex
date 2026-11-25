import { createMemoryHistory } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  MessageId,
  ProviderInstanceId,
  RunId,
  ScheduledTaskId,
  WS_METHODS,
  type ScheduledTask,
  type ScheduledTaskRunsResult,
} from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import * as Stream from "effect/Stream";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { AppRoot } from "~/AppRoot";
// The route loads ChatView lazily; importing it here keeps its first transform out of the timeout.
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { useRightPanelStore } from "~/rightPanelStore";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  PROJECT_ID,
  answerRpc,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../../test/fakeEnvironment";
import { render } from "../../../test/render";
import { SCHEDULED_RUNS_PANEL_OPEN_KEY } from "./ScheduledThreadPanel";

// The socket is the only fake layer, as in ChatView.browser.test.tsx.
vi.mock(
  "../../../../../packages/client-runtime/src/connection/driver.ts",
  async (importOriginal) => {
    const [actual, { fakeDriver }, Layer] = await Promise.all([
      importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
      import("../../../test/fakeEnvironment"),
      import("effect/Layer"),
    ]);
    return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
  },
);

const thread = threadWithHistory("scheduled-run", 1);
const threadRef = scopeThreadRef(ENVIRONMENT_ID, thread.id);
const task: ScheduledTask = {
  id: ScheduledTaskId.make("morning-desk"),
  title: "Morning desk (08:50, weekdays)",
  prompt: "Collect the results",
  enabled: true,
  schedule: { type: "fixed_time", timeOfDay: "08:50" },
  projectId: PROJECT_ID,
  threadId: null,
  workspaceStrategy: { type: "root" },
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "auto",
  interactionMode: "default",
  createdBy: "user",
  creationSource: "web",
  createdAt: "2026-11-20T09:00:00.000Z",
  updatedAt: "2026-11-20T09:00:00.000Z",
  nextRunAt: "2026-11-26T07:50:00.000Z",
  lastRunAt: "2026-11-25T07:50:00.000Z",
  lastRunStatus: "succeeded",
  lastRunError: null,
  runCount: 1,
};
const runs: ScheduledTaskRunsResult = {
  taskId: task.id,
  runs: [
    {
      runId: RunId.make("scheduled-run-run-0"),
      threadId: thread.id,
      userMessageId: MessageId.make("scheduled-run-user-0"),
      assistantMessageId: MessageId.make("scheduled-run-assistant-0"),
      status: "completed",
      requestedAt: "2026-11-25T07:50:00.000Z",
    },
  ],
};

/** Width of the native caption buttons on Windows, which a browser cannot draw. */
const NATIVE_CONTROLS_WIDTH = 138;

type Mode = "web" | "wco";

/**
 * Stands in for Electron's window-controls overlay: the `.wco` class with the insets Electron's
 * `env(titlebar-area-*)` would give, and a box where the native caption buttons would sit.
 */
function simulateWindowControlsOverlay() {
  const root = document.documentElement;
  const inset = `calc(${NATIVE_CONTROLS_WIDTH}px + 0.75rem)`;
  root.classList.add("wco");
  root.style.setProperty("--workspace-controls-right", inset);
  root.style.setProperty("--workspace-native-controls-inset", inset);
  const native = document.createElement("div");
  native.dataset.testNativeControls = "";
  native.style.cssText = `position:fixed;top:0;right:0;width:${NATIVE_CONTROLS_WIDTH}px;height:var(--workspace-topbar-height);background:rgb(220 38 38 / 25%);pointer-events:none;z-index:2147483647`;
  document.body.append(native);
  return {
    [Symbol.dispose]() {
      root.classList.remove("wco");
      root.style.removeProperty("--workspace-controls-right");
      root.style.removeProperty("--workspace-native-controls-inset");
      native.remove();
    },
  };
}

/** Lets popovers and sheets finish opening, so their rects are where they come to rest. */
async function settle() {
  const finite = document
    .getAnimations()
    .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity);
  await Promise.all(finite.map((animation) => animation.finished));
}

function rectOf(element: Element) {
  return element.getBoundingClientRect();
}

function overlaps(a: DOMRect, b: DOMRect) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function visibleTitlebarControls() {
  return [...document.querySelectorAll("[data-workspace-titlebar-controls]")].filter((element) => {
    const rect = rectOf(element);
    return rect.width > 0 && rect.height > 0;
  });
}

function nativeControls() {
  return document.querySelector("[data-test-native-controls]");
}

/** The chat's panel toggles stay inside the chat: clear of the runs panel and the native buttons. */
function expectControlsClearOf(panel: Element) {
  const controls = visibleTitlebarControls();
  expect(controls.length).toBeGreaterThan(0);
  const panelRect = rectOf(panel);
  for (const control of controls) {
    const rect = rectOf(control);
    expect(overlaps(rect, panelRect), "chat titlebar controls overlap the runs panel").toBe(false);
    expect(rect.right).toBeLessThanOrEqual(panelRect.left);
    const native = nativeControls();
    if (native) {
      expect(overlaps(rect, rectOf(native)), "chat titlebar controls overlap native ones").toBe(
        false,
      );
    }
  }
  const header = document.querySelector("[data-chat-header]");
  expect(header).not.toBeNull();
  expect(rectOf(header!).right).toBeLessThanOrEqual(panelRect.left);
}

async function renderScheduledChat(options: { readonly width: number; readonly mode: Mode }) {
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  await page.viewport(options.width, 800);
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  const screen = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
  await expect.element(page.getByText(`Answer 0 for ${thread.id}.`).first()).toBeVisible();
  return screen;
}

const detailsCard = () => document.querySelector("[data-thread-details-panel]");
const runsPanel = () => page.getByRole("complementary", { name: "Runs" });
const runsRail = () => document.querySelector("[data-scheduled-runs-rail]");

describe.each<Mode>(["wco", "web"])("runs panel beside a chat (%s)", (mode) => {
  /** The environment with the task, and the overlay in `wco` mode, until disposed. */
  const setup = (): Disposable => {
    localStorage.removeItem(SCHEDULED_RUNS_PANEL_OPEN_KEY);
    const held = [
      installFakeEnvironment([thread]),
      answerRpc(WS_METHODS.scheduledTasksSubscribe, () =>
        Stream.concat(Stream.make({ tasks: [task] }), Stream.never),
      ),
      answerRpc(WS_METHODS.scheduledTasksSubscribeRuns, () =>
        Stream.concat(Stream.make(runs), Stream.never),
      ),
      ...(mode === "wco" ? [simulateWindowControlsOverlay()] : []),
    ];
    return {
      [Symbol.dispose]() {
        for (const item of held.toReversed()) item[Symbol.dispose]();
        useRightPanelStore.setState({ byThreadKey: {}, threadPanelVisibilityByThreadKey: {} });
        localStorage.removeItem(SCHEDULED_RUNS_PANEL_OPEN_KEY);
      },
    };
  };

  it("keeps the chat's toggles and details card out of the open panel", async () => {
    using _environment = setup();
    await using _screen = await renderScheduledChat({ width: 1400, mode });
    await expect.element(runsPanel()).toBeVisible();
    const panel = runsPanel().element();
    expectControlsClearOf(panel);

    const label = panel.querySelector("span.truncate");
    expect(label?.textContent).toBe("Scheduled");
    expect(label!.scrollWidth).toBeLessThanOrEqual(label!.clientWidth);
    const native = nativeControls();
    if (native) expect(overlaps(rectOf(label!), rectOf(native))).toBe(false);

    // Wide chats dock the card open; narrower ones open it as a popover from the toggle.
    const toggle = page.getByRole("button", { name: "Toggle thread details panel" });
    if (detailsCard() === null) await userEvent.click(toggle);
    await expect.poll(() => detailsCard()?.getAttribute("data-thread-details-panel")).toBeTruthy();
    await settle();
    const card = rectOf(detailsCard()!);
    const toggleRect = rectOf(toggle.element());
    expect(card.right).toBeLessThanOrEqual(rectOf(panel).left);
    // The card opens under the toggle that opened it.
    expect(card.left).toBeLessThan(toggleRect.right);
    expect(card.right).toBeGreaterThan(toggleRect.left);
  });

  it("fits the task, its actions and its runs in the panel at the narrowest width", async () => {
    using _environment = setup();
    await using _screen = await renderScheduledChat({ width: 1024, mode });
    await expect.element(runsPanel()).toBeVisible();
    const panel = runsPanel().element();
    const panelRect = rectOf(panel);
    expect(panelRect.width).toBe(288);
    expectControlsClearOf(panel);
    const label = panel.querySelector("span.truncate");
    expect(label!.scrollWidth).toBeLessThanOrEqual(label!.clientWidth);
    for (const name of ["Hide runs", "Details", "Edit", "Run now", "Pause", "Delete"]) {
      const button = runsPanel().getByRole("button", { name, exact: true });
      await expect.element(button).toBeVisible();
      const rect = rectOf(button.element());
      expect(rect.left, name).toBeGreaterThanOrEqual(panelRect.left);
      expect(rect.right, name).toBeLessThanOrEqual(panelRect.right);
      const native = nativeControls();
      if (native) expect(overlaps(rect, rectOf(native)), name).toBe(false);
    }
    const run = runsPanel()
      .getByRole("button", { name: /Completed/ })
      .element();
    expect(rectOf(run).right).toBeLessThanOrEqual(panelRect.right);
  });

  it("keeps the chat's toggles out of the folded rail", async () => {
    using _environment = setup();
    await using _screen = await renderScheduledChat({ width: 1400, mode });
    await userEvent.click(page.getByRole("button", { name: "Hide runs" }));
    await expect.element(runsPanel()).not.toBeInTheDocument();
    const rail = runsRail();
    expect(rail).not.toBeNull();
    expect(rectOf(rail!).width).toBe(40);
    expectControlsClearOf(rail!);
    await expect.element(page.getByRole("button", { name: "Show runs" })).toBeVisible();
  });

  it("keeps the chat's toggles out of the panel while the chat's right panel is open", async () => {
    using _environment = setup();
    useRightPanelStore.getState().open(threadRef, "diff");
    await using _screen = await renderScheduledChat({ width: 1400, mode });
    await expect.element(runsPanel()).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Maximize panel" })).toBeVisible();
    expectControlsClearOf(runsPanel().element());

    await userEvent.click(page.getByRole("button", { name: "Maximize panel" }));
    await expect.element(page.getByRole("button", { name: "Restore panel size" })).toBeVisible();
    for (const control of visibleTitlebarControls()) {
      expect(overlaps(rectOf(control), rectOf(runsPanel().element()))).toBe(false);
    }
  });

  it("opens the runs from a rail in a narrow window, clear of the chat's toggles", async () => {
    using _environment = setup();
    await using _screen = await renderScheduledChat({ width: 900, mode });
    await expect.element(runsPanel()).not.toBeInTheDocument();
    const rail = runsRail();
    expect(rail).not.toBeNull();
    expectControlsClearOf(rail!);

    await userEvent.click(page.getByRole("button", { name: "Runs", exact: true }));
    const sheet = page.getByRole("dialog");
    await expect.element(sheet.getByRole("heading", { name: task.title })).toBeVisible();
    await settle();
    const sheetRect = rectOf(sheet.element());
    for (const control of visibleTitlebarControls()) {
      expect(overlaps(rectOf(control), sheetRect), "chat titlebar controls cover the sheet").toBe(
        false,
      );
    }
    const native = nativeControls();
    if (native) expect(overlaps(sheetRect, rectOf(native))).toBe(false);
    await expect.element(sheet.getByRole("button", { name: "Close" })).toBeVisible();
  });
});
