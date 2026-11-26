import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { RunId } from "@t3tools/contracts";

import { limitRecoveryScheduleState } from "../chat/UsageLimitRecoveryBanner";
import {
  hasUnseenCompletion,
  resolveSidebarRowStatus,
  resolveThreadLastVisitedAt,
} from "../Sidebar.logic";

/**
 * Most urgent first. Upstream's closed-folder dot ranks attention, failed, unread, working;
 * the lamp splits attention into the row states that make it up, in the rows' own order.
 */
export const SECTION_LAMP_TONES = [
  "approval",
  "input",
  "request",
  "limited",
  "failed",
  "done",
  "working",
] as const;

export type SectionLampTone = (typeof SECTION_LAMP_TONES)[number];
export type SectionLampCounts = Readonly<Partial<Record<SectionLampTone, number>>>;

export interface SectionLamp {
  /** The most urgent state among the counted threads. */
  readonly tone: SectionLampTone;
  /** Threads that need the user: everything except working. */
  readonly waiting: number;
  readonly counts: SectionLampCounts;
}

type LimitRecoveryThread = Pick<
  EnvironmentThreadShell,
  | "runtime"
  | "latestRun"
  | "updatedAt"
  | "settledOverride"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "snoozedUntil"
> &
  Partial<Pick<EnvironmentThreadShell, "limitRecovery">>;

type SectionLampThread = Parameters<typeof resolveSidebarRowStatus>[0] &
  Partial<LimitRecoveryThread>;

/** What the chat's usage-limit banner sees for a thread stopped on a usage limit, or null. */
function threadLimitRecovery(thread: Partial<LimitRecoveryThread>): {
  readonly runId: RunId;
  readonly resetAt: string;
  readonly resumes: boolean;
} | null {
  const { runtime, latestRun } = thread;
  if (runtime?.status !== "failed" || runtime.lastErrorClass !== "usage_limit") return null;
  const resetAt = runtime.usageLimitResetAt ?? null;
  if (latestRun == null || resetAt === null) return null;
  const { canSchedule, resumes } = limitRecoveryScheduleState({
    runId: latestRun.runId,
    resetAt,
    stoppedAt: latestRun.completedAt ?? thread.updatedAt ?? resetAt,
    settled: thread.settledOverride === "settled",
    requestPending: thread.hasPendingApprovals === true || thread.hasPendingUserInput === true,
    recovery: thread.limitRecovery ?? null,
    snoozedUntil: thread.snoozedUntil ?? null,
  });
  return canSchedule ? { runId: latestRun.runId, resetAt, resumes } : null;
}

/** The banner's "Resume at reset" for this thread, when it is offered and not already on. */
export function resumeAtResetTarget(thread: Partial<LimitRecoveryThread>) {
  const recovery = threadLimitRecovery(thread);
  return recovery === null || recovery.resumes
    ? null
    : { runId: recovery.runId, resetAt: recovery.resetAt };
}

/** The lamp state one thread contributes: the state its own sidebar row shows, or null. */
export function sectionLampToneOfThread(thread: SectionLampThread): SectionLampTone | null {
  const status = resolveSidebarRowStatus(thread);
  switch (status) {
    case "approval":
    case "input":
    case "request":
    case "failed":
      return status;
    // Auto-resume is on: the chat will carry on by itself, so it no longer needs the user.
    case "limited":
      return threadLimitRecovery(thread)?.resumes === true ? null : status;
    case "preparing":
    case "working":
      return "working";
    // Rows show Done only for ready threads; a waiting thread stays quiet.
    case "ready":
      return hasUnseenCompletion(thread) ? "done" : null;
    default:
      return null;
  }
}

export function countSectionLampTones(
  tones: Iterable<SectionLampTone | null>,
): Partial<Record<SectionLampTone, number>> {
  const counts: Partial<Record<SectionLampTone, number>> = {};
  for (const tone of tones) {
    if (tone !== null) counts[tone] = (counts[tone] ?? 0) + 1;
  }
  return counts;
}

export function resolveSectionLamp(counts: SectionLampCounts): SectionLamp | null {
  const tone = SECTION_LAMP_TONES.find((candidate) => (counts[candidate] ?? 0) > 0);
  if (tone === undefined) return null;
  const waiting = SECTION_LAMP_TONES.reduce(
    (sum, candidate) => (candidate === "working" ? sum : sum + (counts[candidate] ?? 0)),
    0,
  );
  return { tone, waiting, counts };
}

/** A thread's lamp state with the same visit time its row reads (server first, else local). */
export function sectionLampToneOfVisitedThread(
  thread: SectionLampThread,
  localLastVisitedAt: string | undefined,
): SectionLampTone | null {
  return sectionLampToneOfThread({
    ...thread,
    lastVisitedAt: resolveThreadLastVisitedAt(thread.lastVisitedAt, localLastVisitedAt),
  });
}

export function resolveSidebarSectionLamp<T extends SectionLampThread>(
  threads: readonly T[],
  toneOf: (thread: T) => SectionLampTone | null = sectionLampToneOfThread,
): SectionLamp | null {
  if (threads.length === 0) return null;
  return resolveSectionLamp(countSectionLampTones(threads.map(toneOf)));
}

/** The lamp's usage-limited chats that "Resume all at reset" would schedule. */
export function resumableLimitedThreads<T extends SectionLampThread>(
  threads: readonly T[],
  toneOf: (thread: T) => SectionLampTone | null = sectionLampToneOfThread,
): T[] {
  return threads.filter(
    (thread) => toneOf(thread) === "limited" && resumeAtResetTarget(thread) !== null,
  );
}

/** Tones "Mark all as read" clears: an unread result or an unseen failure, never a question. */
export function isReadClearableTone(tone: SectionLampTone | null) {
  return tone === "done" || tone === "failed";
}
