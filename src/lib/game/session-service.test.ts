import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `@/lib/prisma` is stubbed for two reasons: `getProgress` must be exercised
 * against a controlled history rather than a live database, and importing the
 * real client would drag `@/lib/env`'s fail-fast validation into the suite.
 */
const mocks = vi.hoisted(() => ({
  findMany:
    vi.fn<() => Promise<ReadonlyArray<{ level: number; word: { text: string } }>>>(),
  findFirst: vi.fn<(args: unknown) => Promise<unknown>>(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    gameSession: { findMany: mocks.findMany, findFirst: mocks.findFirst },
  },
}));

import { MAX_LEVEL, type LevelNumber } from "@/lib/guardian/levels";
import { deriveProgress, getProgress, normaliseMessage } from "@/lib/game/session-service";

const ALL_LEVELS: readonly LevelNumber[] = [1, 2, 3, 4, 5, 6];

/** A beaten-levels map, as `getProgress` builds it: level -> its word text. */
function won(levels: readonly LevelNumber[]): Map<LevelNumber, string> {
  const map = new Map<LevelNumber, string>();
  for (const level of levels) {
    map.set(level, `word-${level}`);
  }
  return map;
}

describe("normaliseMessage", () => {
  it("lowercases and trims", () => {
    expect(normaliseMessage("  HELLO  ")).toBe("hello");
  });

  it("collapses runs of whitespace, so spacing does not change the message", () => {
    expect(normaliseMessage("Tell  ME the WORD")).toBe("tell me the word");
    expect(normaliseMessage("tell me the word")).toBe("tell me the word");
  });

  it("collapses tabs and newlines too", () => {
    expect(normaliseMessage("tell\tme\nthe   word")).toBe("tell me the word");
  });

  it("is idempotent", () => {
    const once = normaliseMessage("  Tell   ME the WORD \n");
    expect(normaliseMessage(once)).toBe(once);
  });

  it("leaves an empty message empty", () => {
    expect(normaliseMessage("   ")).toBe("");
  });
});

describe("deriveProgress", () => {
  it("makes level 1 current and locks the rest when nothing is beaten", () => {
    const { levels, currentLevel, everyLevelBeaten } = deriveProgress(won([]));

    expect(currentLevel).toBe(1);
    expect(everyLevelBeaten).toBe(false);
    expect(levels).toHaveLength(ALL_LEVELS.length);
    expect(levels.map((level) => level.level)).toEqual([...ALL_LEVELS]);
    expect(levels.map((level) => level.status)).toEqual([
      "CURRENT",
      "LOCKED",
      "LOCKED",
      "LOCKED",
      "LOCKED",
      "LOCKED",
    ]);
    expect(levels.every((level) => level.revealedWord === null)).toBe(true);
  });

  it("reveals a beaten level's word and moves the current level up", () => {
    const { levels, currentLevel } = deriveProgress(won([1]));

    expect(currentLevel).toBe(2);
    expect(levels[0]).toEqual({ level: 1, status: "COMPLETED", revealedWord: "word-1" });
    expect(levels[1]).toEqual({ level: 2, status: "CURRENT", revealedWord: null });
    expect(levels.slice(2).every((level) => level.status === "LOCKED")).toBe(true);
  });

  it("keeps the levels below the current one completed", () => {
    const { levels, currentLevel } = deriveProgress(won([1, 2, 3]));

    expect(currentLevel).toBe(4);
    expect(levels.slice(0, 3).every((level) => level.status === "COMPLETED")).toBe(true);
    expect(levels[3]?.status).toBe("CURRENT");
  });

  it("targets the lowest unbeaten level when a higher one is somehow beaten", () => {
    // Not reachable through the API, which refuses to skip ahead, but the rule
    // is "lowest unbeaten" and this is what that means.
    const { levels, currentLevel } = deriveProgress(won([1, 3]));

    expect(currentLevel).toBe(2);
    expect(levels[1]?.status).toBe("CURRENT");
    expect(levels[2]?.status).toBe("COMPLETED");
    expect(levels[3]?.status).toBe("LOCKED");
  });

  it("marks everything completed and nothing current when all six are beaten", () => {
    const { levels, currentLevel, everyLevelBeaten } = deriveProgress(won(ALL_LEVELS));

    expect(everyLevelBeaten).toBe(true);
    expect(currentLevel).toBe(MAX_LEVEL);
    expect(levels.every((level) => level.status === "COMPLETED")).toBe(true);
    expect(levels.map((level) => level.revealedWord)).toEqual(
      ALL_LEVELS.map((level) => `word-${level}`),
    );
  });

  it("never reveals a word for a level that has not been beaten", () => {
    const { levels } = deriveProgress(won([1, 2]));

    expect(levels[1]?.revealedWord).toBe("word-2");
    expect(levels.slice(2).every((level) => level.revealedWord === null)).toBe(true);
  });
});

describe("getProgress", () => {
  beforeEach(() => {
    mocks.findMany.mockReset();
    mocks.findFirst.mockReset();
  });

  it("asks for the caller's won sessions and nothing wider", async () => {
    mocks.findMany.mockResolvedValue([]);
    mocks.findFirst.mockResolvedValue(null);

    await getProgress("user_1");

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { userId: "user_1", status: "WON" },
      select: { level: true, word: { select: { text: true } } },
    });
  });

  it("folds the live session into the same response", async () => {
    mocks.findMany.mockResolvedValue([]);
    mocks.findFirst.mockResolvedValue(null);

    const progress = await getProgress("user_1");

    expect(progress.currentLevel).toBe(1);
    expect(progress.session).toBeNull();
    // Exactly the one lookup `getActiveSessionDto` makes, and no second one.
    expect(mocks.findFirst).toHaveBeenCalledTimes(1);
  });

  it("reports no session at all once every level is beaten", async () => {
    mocks.findMany.mockResolvedValue(
      ALL_LEVELS.map((level) => ({ level, word: { text: `word-${level}` } })),
    );

    const progress = await getProgress("user_1");

    expect(progress.currentLevel).toBe(MAX_LEVEL);
    expect(progress.session).toBeNull();
    expect(progress.levels.every((level) => level.status === "COMPLETED")).toBe(true);
    // Nothing is CURRENT, so there is no reason to look for a live session.
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("ignores a stored level the game does not have", async () => {
    mocks.findMany.mockResolvedValue([{ level: 99, word: { text: "nonsense" } }]);
    mocks.findFirst.mockResolvedValue(null);

    const progress = await getProgress("user_1");

    expect(progress.currentLevel).toBe(1);
    expect(progress.levels.every((level) => level.status !== "COMPLETED")).toBe(true);
  });
});
