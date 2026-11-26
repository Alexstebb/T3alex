import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { SidebarSectionLamp, type SectionLampEntry } from "./SidebarSectionLamp";

const FUTURE = "2099-01-01T15:00:00.000Z";

describe("SidebarSectionLamp resume at reset", () => {
  it("offers Resume at reset per limited chat and for all of them, while the row still opens", async () => {
    const opened = vi.fn();
    const resumed = vi.fn(async () => {});
    const resumedAll = vi.fn(async () => {});
    const entries: SectionLampEntry[] = [
      { key: "a", tone: "input", title: "Needs an answer", onOpen: opened },
      {
        key: "b",
        tone: "limited",
        title: "Codex refactor stopped on its limit",
        onOpen: opened,
        resume: { resetAt: FUTURE, run: resumed },
      },
      {
        key: "c",
        tone: "limited",
        title: "Codex tests",
        onOpen: opened,
        resume: { resetAt: "2000-01-01T00:00:00.000Z", run: resumed },
      },
      { key: "d", tone: "limited", title: "Reset time unknown", onOpen: opened },
    ];
    await using screen = await render(
      <div className="flex w-72 justify-end bg-sidebar p-4">
        <SidebarSectionLamp
          lamp={{ tone: "input", waiting: 4, counts: { input: 1, limited: 3 } }}
          entries={entries}
          onMarkAllRead={() => {}}
          onResumeAll={resumedAll}
        />
      </div>,
    );
    (screen.container.querySelector("[data-section-lamp]") as HTMLElement).click();
    await expect.poll(() => document.querySelectorAll("[data-section-lamp-resume]").length).toBe(2);
    const popover = document.querySelector("[data-section-lamp-popover]") as HTMLElement;
    expect(popover.textContent).toContain("Resume at reset");
    expect(popover.textContent).toContain("Resume now");
    expect(popover.textContent).toContain("Resume all at reset");
    if (import.meta.env.VITE_LAMP_SCREENSHOT) {
      await page.screenshot({ path: "lamp-popover.png", element: popover });
    }

    (document.querySelector("[data-section-lamp-resume]") as HTMLElement).click();
    await expect.poll(() => resumed.mock.calls.length).toBe(1);
    expect(opened).not.toHaveBeenCalled();
    (document.querySelector("[data-section-lamp-resume-all]") as HTMLElement).click();
    await expect.poll(() => resumedAll.mock.calls.length).toBe(1);
  });
});
