import { describe, expect, it } from "@effect/vitest";

import { resolveSpellCheckerLanguages } from "./spellCheckerLanguages.ts";

const AVAILABLE = ["en-GB", "en-US", "nb", "sv", "de-DE"];

describe("resolveSpellCheckerLanguages", () => {
  it("checks Norwegian and US English on an English-only system", () => {
    expect(resolveSpellCheckerLanguages(["en-US"], AVAILABLE)).toEqual(["nb", "en-US"]);
  });

  it("maps Norwegian system locales to the bokmål dictionary without duplicates", () => {
    expect(resolveSpellCheckerLanguages(["nb-NO", "no", "en-GB"], AVAILABLE)).toEqual([
      "nb",
      "en-GB",
      "en-US",
    ]);
  });

  it("keeps other OS languages and drops ones Chromium cannot check", () => {
    expect(resolveSpellCheckerLanguages(["sv_SE", "de", "xx"], AVAILABLE)).toEqual([
      "nb",
      "sv",
      "de-DE",
      "en-US",
    ]);
  });
});
