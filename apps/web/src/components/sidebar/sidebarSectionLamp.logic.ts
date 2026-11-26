import { hasUnseenCompletion, resolveSidebarRowStatus } from "../Sidebar.logic";

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

type SectionLampThread = Parameters<typeof resolveSidebarRowStatus>[0];

/** The lamp state one thread contributes: the state its own sidebar row shows, or null. */
export function sectionLampToneOfThread(thread: SectionLampThread): SectionLampTone | null {
  const status = resolveSidebarRowStatus(thread);
  switch (status) {
    case "approval":
    case "input":
    case "request":
    case "limited":
    case "failed":
      return status;
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

export function resolveSidebarSectionLamp(
  threads: readonly SectionLampThread[],
): SectionLamp | null {
  return resolveSectionLamp(countSectionLampTones(threads.map(sectionLampToneOfThread)));
}
