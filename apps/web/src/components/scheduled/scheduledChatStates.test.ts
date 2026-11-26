import {
  EnvironmentId,
  ProjectId,
  ScheduledTaskId,
  ThreadId,
  type ScheduledTask,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture } from "../../test-fixtures";
import type { Thread } from "../../types";
import type { SectionLampTone } from "../sidebar/sidebarSectionLamp.logic";
import { scheduledChatStates } from "./scheduledChatStates";
import {
  scheduledSidebarLamp,
  scheduledTaskLampTone,
  scheduledTaskOrganizationKey,
} from "./scheduledTaskOrganization";

const environmentId = EnvironmentId.make("local");
const taskId = ScheduledTaskId.make("sentralbord");
const taskKey = scheduledTaskOrganizationKey(environmentId, taskId);
const organization = {
  pinnedTaskKeys: [],
  sections: [],
  collapsedGroups: [],
  lastSeenAt: {},
};
const task = (patch: Partial<ScheduledTask> = {}) =>
  ({
    id: taskId,
    title: "Sentralbordet",
    enabled: true,
    threadId: null,
    lastRunAt: null,
    lastRunStatus: "succeeded",
    schedule: { type: "interval", everyMinutes: 60 },
    ...patch,
  }) as unknown as ScheduledTask;

const chat = (id: string) =>
  makeThreadFixture({ environmentId, id: ThreadId.make(id), projectId: ProjectId.make("claude") });
const tones: Record<string, SectionLampTone | null> = {};
const states = (threads: readonly Thread[], rows = [{ environmentId, task: task() }]) =>
  scheduledChatStates({
    rows,
    threads,
    taskKeyByThreadKey: new Map([
      ["local:run-today", taskKey],
      ["local:run-yesterday", taskKey],
    ]),
    toneOf: (thread) => tones[thread.id] ?? null,
  });

describe("scheduledChatStates", () => {
  it("takes the most urgent state of a task's run chats", () => {
    tones["run-today"] = "working";
    tones["run-yesterday"] = "input";
    const state = states([chat("run-today"), chat("run-yesterday"), chat("mine")]).get(taskKey);
    expect(state?.tone).toBe("input");
    expect(state?.thread?.id).toBe("run-yesterday");
  });

  it("counts a chat the task continues in, and leaves the user's other chats alone", () => {
    tones["continued"] = "approval";
    tones["mine"] = "approval";
    const rows = [{ environmentId, task: task({ threadId: ThreadId.make("continued") }) }];
    const all = states([chat("continued"), chat("mine")], rows);
    expect(all.get(taskKey)?.tone).toBe("approval");
    expect(all.size).toBe(1);
  });

  it("leaves an unread reply to the task's own seen state but offers it for marking read", () => {
    tones["run-today"] = "done";
    tones["run-yesterday"] = "failed";
    const state = states([chat("run-today"), chat("run-yesterday")]).get(taskKey);
    expect(state?.tone).toBe("failed");
    expect(state?.unreadThreads.map((thread) => thread.id)).toEqual(["run-today", "run-yesterday"]);
  });
});

describe("the Scheduled lamp with run chats", () => {
  it("lights for a run chat waiting for the user even when the task itself looks done", () => {
    expect(scheduledTaskLampTone(organization, taskKey, task(), null)).toBeNull();
    expect(scheduledTaskLampTone(organization, taskKey, task(), "input")).toBe("input");
    expect(
      scheduledTaskLampTone(organization, taskKey, task({ lastRunStatus: "running" }), "approval"),
    ).toBe("approval");
    expect(
      scheduledSidebarLamp(
        [{ environmentId, task: task() }],
        organization,
        Date.parse("2026-11-26T12:00:00.000Z"),
        () => "input",
      )?.tone,
    ).toBe("input");
  });
});
