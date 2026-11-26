import { SECTION_LAMP_TONES, type SectionLampTone } from "./sidebarSectionLamp.logic";

/** Rows an open section shows before "Show more", and how many more each click reveals. */
export const SECTION_INITIAL_ROW_COUNT = 10;
export const SECTION_ROW_PAGE_COUNT = 25;

/** The lamp states that need the user, most urgent first; working chats do not. */
const NEEDS_USER_RANK = new Map<SectionLampTone, number>(
  SECTION_LAMP_TONES.filter((tone) => tone !== "working").map((tone, rank) => [tone, rank]),
);

function needsUserRank(tone: SectionLampTone | null): number | undefined {
  return tone === null ? undefined : NEEDS_USER_RANK.get(tone);
}

export interface SectionArrangementInput<T> {
  readonly threads: readonly T[];
  readonly keyOf: (thread: T) => string;
  readonly toneOf: (thread: T) => SectionLampTone | null;
  readonly isPinned: (thread: T) => boolean;
  readonly routeThreadKey: string | null;
  /** Rows to show before the rest is folded behind "Show more". */
  readonly limit: number;
}

/**
 * The open section's rows: pinned chats first (as pins lead everywhere else), then the
 * chats that need the user in the lamp's order, then the rest in their stored order.
 * Past the limit, pinned rows, rows that need the user and the open chat still show.
 */
export function arrangeSectionThreads<T>(input: SectionArrangementInput<T>) {
  const pinned: T[] = [];
  const needing: { thread: T; rank: number }[] = [];
  const rest: T[] = [];
  for (const thread of input.threads) {
    if (input.isPinned(thread)) {
      pinned.push(thread);
      continue;
    }
    const rank = needsUserRank(input.toneOf(thread));
    if (rank === undefined) rest.push(thread);
    else needing.push({ thread, rank });
  }
  // Array.prototype.sort is stable, so equal ranks keep their stored order.
  needing.sort((a, b) => a.rank - b.rank);
  const ordered = [...pinned, ...needing.map(({ thread }) => thread), ...rest];
  const keep = new Set<T>([...pinned, ...needing.map(({ thread }) => thread)]);
  const shown = ordered.filter(
    (thread, index) =>
      index < input.limit ||
      keep.has(thread) ||
      (input.routeThreadKey !== null && input.keyOf(thread) === input.routeThreadKey),
  );
  return {
    threads: shown.length === ordered.length ? ordered : shown,
    /** Rows folded behind "Show more". */
    foldedCount: ordered.length - shown.length,
  };
}

/**
 * Whether a section leaves out a chat a scheduled run started: those live under Scheduled.
 * It stays when the user put it in the section by hand, pinned it, or has it open.
 */
export function hidesScheduledRun(input: {
  readonly threadKey: string;
  readonly scheduledRunThreadKeys: ReadonlySet<string>;
  readonly placedByHand: boolean;
  readonly pinned: boolean;
  readonly routeThreadKey: string | null;
}) {
  return (
    input.scheduledRunThreadKeys.has(input.threadKey) &&
    !input.placedByHand &&
    !input.pinned &&
    input.threadKey !== input.routeThreadKey
  );
}
