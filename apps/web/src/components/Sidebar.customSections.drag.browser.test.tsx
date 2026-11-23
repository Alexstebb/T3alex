import { createMemoryHistory } from "@tanstack/react-router";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";
import appCss from "../index.css?inline";

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));
function mountAppStyles() {
  const style = document.createElement("style");
  style.textContent = appCss;
  document.head.append(style);
  return { [Symbol.dispose]: () => style.remove() };
}

it.each([false, true])(
  "drops a thread onto a closed section and then into another section's list (project folders: %s)",
  async (boringSidebarEnabled) => {
    await page.viewport(1400, 900);
    using _styles = mountAppStyles();
    const realNow = performance.now.bind(performance);
    let clockOffset = 0;
    using _clock = vi.spyOn(performance, "now").mockImplementation(() => realNow() + clockOffset);
    const first = threadWithHistory("visible", 1);
    const moving = threadWithHistory("move-me", 1);
    const destination = threadWithHistory("already-grouped", 1);
    using _environment = installFakeEnvironment([first, moving, destination]);
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      boringSidebarEnabled,
      onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    });
    const storageKey = "t3code:sidebar:custom-sections";
    using cleanup = new DisposableStack();
    cleanup.defer(() => localStorage.removeItem(storageKey));
    localStorage.setItem(
      storageKey,
      JSON.stringify([
        { id: "support", name: "Support", collapsed: true, threadKeys: [] },
        {
          id: "waiting",
          name: "Waiting on customer",
          collapsed: false,
          threadKeys: [scopedThreadKey(scopeThreadRef(ENVIRONMENT_ID, destination.id))],
        },
      ]),
    );
    const router = getRouter(
      createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${first.id}`] }),
    );
    await router.load();
    await using _app = await render(<AppRoot router={router} />, { router: false });
    const support = page.getByRole("button", { name: "Support", exact: true });
    const waiting = page.getByRole("button", { name: "Waiting on customer", exact: true });
    const groupedRow = (title: string) =>
      page.getByTestId("sidebar-row-folder").filter({ hasText: title });
    const ungrouped = page
      .getByTestId(boringSidebarEnabled ? "sidebar-row-folder" : "sidebar-row-card")
      .filter({ hasText: moving.title });
    await expect.element(ungrouped).toBeVisible();
    await expect.element(support).toHaveAttribute("aria-expanded", "false");
    // Initial hydration can shift rows under the pointer and temporarily reject the press.
    clockOffset += 550;

    await userEvent.dragAndDrop(ungrouped, support);
    expect(JSON.parse(localStorage.getItem(storageKey)!)[0].threadKeys).toContain(
      scopedThreadKey(scopeThreadRef(ENVIRONMENT_ID, moving.id)),
    );
    await expect.element(ungrouped).not.toBeInTheDocument();
    await expect.element(support).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(support);
    const moved = groupedRow(moving.title);
    await expect.element(moved).toHaveAttribute("data-sidebar-parent", "custom-section:support");

    await expect.element(waiting).toHaveAttribute("aria-expanded", "true");
    await userEvent.dragAndDrop(moved, groupedRow(destination.title));
    await expect.element(moved).toHaveAttribute("data-sidebar-parent", "custom-section:waiting");
  },
);
