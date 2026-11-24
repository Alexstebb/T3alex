import { describe, expect, it } from "vite-plus/test";

import {
  linkSidebarSectionProject,
  setSidebarSectionChatProject,
  sidebarSectionChatProject,
  type CustomSidebarSection,
} from "./sidebarSections";

const section = (patch: Partial<CustomSidebarSection> = {}): CustomSidebarSection => ({
  id: "a",
  name: "Kunder",
  collapsed: false,
  threadKeys: [],
  ...patch,
});

const projects = new Map([
  ["claude", { title: "Claude", workspaceRoot: "/docs/Claude", archivedAt: null }],
  ["linked", { title: "Linked", workspaceRoot: "/docs/linked", archivedAt: null }],
  ["old", { title: "Old", workspaceRoot: "/docs/old", archivedAt: "2026-11-23T00:00:00.000Z" }],
]);
const find = (ref: { projectId: string }) => projects.get(ref.projectId) ?? null;

describe("sidebarSectionChatProject", () => {
  it("prefers the linked project, then the chat folder, else none", () => {
    expect(sidebarSectionChatProject(section(), find)).toBeNull();
    expect(
      sidebarSectionChatProject(section({ chatProjectKey: "local:claude" }), find),
    ).toMatchObject({ mode: "chat", available: true, ref: { projectId: "claude" } });
    expect(
      sidebarSectionChatProject(
        section({ projectKey: "local:linked", chatProjectKey: "local:claude" }),
        find,
      ),
    ).toMatchObject({ mode: "link", available: true, ref: { projectId: "linked" } });
  });

  it("reports a deleted or archived project as unavailable", () => {
    expect(sidebarSectionChatProject(section({ projectKey: "local:gone" }), find)).toMatchObject({
      mode: "link",
      available: false,
      project: null,
    });
    expect(sidebarSectionChatProject(section({ chatProjectKey: "local:old" }), find)).toMatchObject(
      { mode: "chat", available: false, project: { workspaceRoot: "/docs/old" } },
    );
  });
});

describe("setSidebarSectionChatProject", () => {
  it("lets several sections share a chat folder and clears one without touching the others", () => {
    const sections = [section(), section({ id: "b", name: "Privat" })];
    const both = setSidebarSectionChatProject(
      setSidebarSectionChatProject(sections, "a", "local:claude"),
      "b",
      "local:claude",
    );
    expect(both.map((item) => item.chatProjectKey)).toEqual(["local:claude", "local:claude"]);
    const cleared = setSidebarSectionChatProject(both, "a", undefined);
    expect("chatProjectKey" in cleared[0]!).toBe(false);
    expect(cleared[1]).toBe(both[1]);
  });

  it("leaves linking one section per project as it was", () => {
    const sections = [section({ chatProjectKey: "local:claude" }), section({ id: "b" })];
    const linked = linkSidebarSectionProject(sections, "a", "local:claude");
    expect(linkSidebarSectionProject(linked, "b", "local:claude")).toBe(linked);
    expect(linked[0]).toMatchObject({ projectKey: "local:claude", chatProjectKey: "local:claude" });
  });
});
