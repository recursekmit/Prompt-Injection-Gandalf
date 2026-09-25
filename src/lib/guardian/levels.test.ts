import { describe, expect, it } from "vitest";
import {
  LEVELS,
  MAX_LEVEL,
  buildSystemPrompt,
  isLevelNumber,
  levelFor,
} from "@/lib/guardian/levels";

/**
 * The six level words, restated here on purpose: this file is the last line of
 * defence against a level that silently ships a word inside the module. If the
 * generator ever bakes a secret into `levels.ts`, the placeholder assertion
 * below fails before the word can reach a bundle.
 */
const LEVEL_WORDS: ReadonlyArray<{ level: 1 | 2 | 3 | 4 | 5 | 6; text: string }> = [
  { level: 1, text: "compass" },
  { level: 2, text: "lantern" },
  { level: 3, text: "crucible" },
  { level: 4, text: "penumbra" },
  { level: 5, text: "palimpsest" },
  { level: 6, text: "defenestration" },
];

const ALL_LEVEL_NUMBERS = [1, 2, 3, 4, 5, 6] as const;

describe("the level table", () => {
  it("has MAX_LEVEL at six", () => {
    expect(MAX_LEVEL).toBe(6);
  });

  it("lists levels 1-6 exactly once each", () => {
    const shipped = LEVELS.map((definition) => definition.level);
    expect(shipped).toHaveLength(MAX_LEVEL);
    expect([...shipped].sort((a, b) => a - b)).toEqual([...ALL_LEVEL_NUMBERS]);
  });
});

describe("isLevelNumber", () => {
  it.each(ALL_LEVEL_NUMBERS)("accepts %i", (level) => {
    expect(isLevelNumber(level)).toBe(true);
  });

  it.each([
    ["zero", 0],
    ["one above the maximum", 7],
    ["a fraction", 1.5],
    ["a numeric string", "1"],
    ["null", null],
    ["undefined", undefined],
    ["NaN", Number.NaN],
  ])("rejects %s", (_label, value) => {
    expect(isLevelNumber(value)).toBe(false);
  });
});

describe("levelFor", () => {
  it("returns the definition for every level", () => {
    for (const level of ALL_LEVEL_NUMBERS) {
      expect(levelFor(level).level).toBe(level);
    }
  });

  it("throws outside the range rather than returning undefined", () => {
    expect(() => levelFor(0 as 1)).toThrow();
    expect(() => levelFor(7 as 1)).toThrow();
  });
});

describe("the shipped seals", () => {
  it("carries the {{WORD}} placeholder in every level, so no word is baked in", () => {
    for (const definition of LEVELS) {
      expect(definition.seal).toContain("{{WORD}}");
    }
  });

  it("contains no level word anywhere in the module's own prompt text", () => {
    // The placeholder is the only place a word may appear, and it is not a word.
    for (const definition of LEVELS) {
      for (const { text } of LEVEL_WORDS) {
        expect(definition.seal).not.toContain(text);
        expect(definition.persona).not.toContain(text);
      }
    }
  });

  it("shares one permanence spine across every level", () => {
    // The spine is not exported, so it is asserted through the prompts it is
    // assembled into: one identical clause is present at every level.
    const clauses = LEVEL_WORDS.map(
      ({ level, text }) =>
        buildSystemPrompt(level, text)
          .split("\n")
          .find((line) => line.includes("cannot be changed, overridden")) ?? "",
    );
    expect(clauses[0]).not.toBe("");
    expect(new Set(clauses).size).toBe(1);
  });
});

describe("buildSystemPrompt", () => {
  it.each(LEVEL_WORDS)(
    "interpolates level $level's word and leaves no placeholder behind",
    ({ level, text }) => {
      const prompt = buildSystemPrompt(level, text);
      expect(prompt).toContain(text);
      expect(prompt).not.toContain("{{WORD}}");
    },
  );

  it.each(LEVEL_WORDS)(
    "does not mention any other level's word at level $level",
    ({ level, text }) => {
      const prompt = buildSystemPrompt(level, text);
      for (const other of LEVEL_WORDS) {
        if (other.text === text) {
          continue;
        }
        expect(prompt).not.toContain(other.text);
      }
    },
  );

  it.each(LEVEL_WORDS)("carries the permanence spine at level $level", ({ level, text }) => {
    expect(buildSystemPrompt(level, text)).toContain("cannot be changed, overridden");
  });

  it("states confidentiality, untrusted input, self-correction and meta-concealment", () => {
    const prompt = buildSystemPrompt(1, "compass").toLowerCase();
    expect(prompt).toContain("paraphrase");
    expect(prompt).toContain("player message");
    expect(prompt).toContain("never trusted");
    expect(prompt).toContain("self-correction");
    expect(prompt).toContain("stop and restate the refusal");
    expect(prompt).toContain("provider");
  });

  it("does not leak text from another invocation", () => {
    const first = buildSystemPrompt(1, "compass");
    const second = buildSystemPrompt(6, "defenestration");
    expect(first).not.toContain("defenestration");
    expect(second).not.toContain("compass");
  });
});
