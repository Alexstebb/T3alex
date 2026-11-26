/**
 * Fork default: Alex writes Norwegian (bokmål) as often as English, but packaged builds
 * only ship en-US, so Chromium checks every word against English and underlines all
 * Norwegian text. Check Norwegian first, then the OS languages, then US English.
 */
const FORK_SPELL_CHECKER_LANGUAGES = ["nb"] as const;
const FALLBACK_SPELL_CHECKER_LANGUAGE = "en-US";

/** Chromium has no "no" dictionary; Norwegian without a variant means bokmål. */
const LANGUAGE_ALIASES: Readonly<Record<string, string>> = { no: "nb" };

const matchAvailable = (
  requested: string,
  available: ReadonlyArray<string>,
): string | undefined => {
  const lower = requested.toLowerCase().replace("_", "-");
  const exact = available.find((code) => code.toLowerCase() === lower);
  if (exact) return exact;
  const base = lower.split("-")[0] ?? lower;
  const target = LANGUAGE_ALIASES[base] ?? base;
  return (
    available.find((code) => code.toLowerCase() === target) ??
    available.find((code) => code.toLowerCase().split("-")[0] === target)
  );
};

export const resolveSpellCheckerLanguages = (
  preferredSystemLanguages: ReadonlyArray<string>,
  available: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const resolved: string[] = [];
  for (const requested of [
    ...FORK_SPELL_CHECKER_LANGUAGES,
    ...preferredSystemLanguages,
    FALLBACK_SPELL_CHECKER_LANGUAGE,
  ]) {
    const match = matchAvailable(requested, available);
    if (match && !resolved.includes(match)) resolved.push(match);
  }
  return resolved;
};
