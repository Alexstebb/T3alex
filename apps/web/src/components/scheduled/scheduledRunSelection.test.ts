import { RunId, MessageId, ThreadId, type ScheduledTaskRun } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { scheduledRunRevealSnippet, selectedScheduledRun } from "./scheduledRunSelection";

describe("scheduledRunRevealSnippet", () => {
  it("takes the first stretch of prose that renders as written", () => {
    expect(
      scheduledRunRevealSnippet("## Status\n\n**Today:** three tickets wait for an answer."),
    ).toBe("three tickets wait for an answer");
  });

  it("skips code, entities and escapes", () => {
    expect(
      scheduledRunRevealSnippet(
        "```sh\necho this line is inside a code block\n```\n`inline code that is long enough` &amp; then plain prose follows here",
      ),
    ).toBe("then plain prose follows here");
  });

  it("cuts long prose at a word and skips text that occurs twice", () => {
    expect(
      scheduledRunRevealSnippet(
        "The same sentence appears twice.\n\n- The same sentence appears twice.",
      ),
    ).toBeNull();
    const long = "word ".repeat(40).trim();
    const snippet = scheduledRunRevealSnippet(`Intro line that is unique: ${long}`);
    expect(snippet?.length).toBeLessThanOrEqual(80);
    expect(snippet?.endsWith("word")).toBe(true);
  });

  it("finds nothing in a reply without prose", () => {
    expect(scheduledRunRevealSnippet("- a\n- b\n\n| x | y |")).toBeNull();
  });
});

describe("selectedScheduledRun", () => {
  const run = (id: string, threadId: string): ScheduledTaskRun => ({
    runId: RunId.make(id),
    threadId: ThreadId.make(threadId),
    userMessageId: MessageId.make(`${id}-user`),
    assistantMessageId: null,
    status: "completed",
    requestedAt: "2026-11-20T09:00:00.000Z",
  });
  const runs = [run("3", "shared"), run("2", "other"), run("1", "shared")];

  it("prefers the run opened in the thread, else its newest run", () => {
    expect(selectedScheduledRun(runs, ThreadId.make("shared"), RunId.make("1"))?.runId).toBe("1");
    expect(selectedScheduledRun(runs, ThreadId.make("shared"), undefined)?.runId).toBe("3");
    expect(selectedScheduledRun(runs, ThreadId.make("shared"), RunId.make("2"))?.runId).toBe("3");
    expect(selectedScheduledRun(runs, ThreadId.make("none"), undefined)).toBeUndefined();
  });
});
