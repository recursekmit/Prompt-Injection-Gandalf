import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `@/lib/prisma` is stubbed for two reasons: `getProgress` must be exercised
 * against a controlled history rather than a live database, and importing the
 * real client would drag `@/lib/env`'s fail-fast validation into the suite.
 */
const mocks = vi.hoisted(() => ({
  findMany:
    vi.fn<
      () => Promise<
        ReadonlyArray<{
          level: number;
          flag: { value: string } | null;
          word: { text: string } | null;
        }>
      >
    >(),
  findFirst: vi.fn<(args: unknown) => Promise<unknown>>(),
  update: vi.fn<(args: unknown) => Promise<unknown>>(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    gameSession: {
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      update: mocks.update,
    },
  },
}));

import { MAX_LEVEL, type LevelNumber } from "@/lib/guardian/levels";
import { deriveProgress, getProgress, normaliseMessage, submitFlag } from "@/lib/game/session-service";

const ALL_LEVELS: readonly LevelNumber[] = [1, 2, 3];

/** A beaten-levels map, as `getProgress` builds it: level -> its flag value. */
function won(levels: readonly LevelNumber[]): Map<LevelNumber, string> {
  const map = new Map<LevelNumber, string>();
  for (const level of levels) {
    map.set(level, `BTB{level-${level}}`);
  }
  return map;
}

describe("normaliseMessage", () => {
  it("lowercases and trims", () => {
    expect(normaliseMessage("  HELLO  ")).toBe("hello");
  });

  it("collapses runs of whitespace, so spacing does not change the message", () => {
    expect(normaliseMessage("Tell  ME the FLAG")).toBe("tell me the flag");
    expect(normaliseMessage("tell me the flag")).toBe("tell me the flag");
  });

  it("collapses tabs and newlines too", () => {
    expect(normaliseMessage("tell\tme\nthe   flag")).toBe("tell me the flag");
  });

  it("is idempotent", () => {
    const once = normaliseMessage("  Tell   ME the FLAG \n");
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
    expect(levels.map((level) => level.status)).toEqual(["CURRENT", "LOCKED", "LOCKED"]);
    expect(levels.every((level) => level.revealedWord === null)).toBe(true);
  });

  it("reveals a beaten level's flag and moves the current level up", () => {
    const { levels, currentLevel } = deriveProgress(won([1]));

    expect(currentLevel).toBe(2);
    expect(levels[0]).toEqual({ level: 1, status: "COMPLETED", revealedWord: "BTB{level-1}" });
    expect(levels[1]).toEqual({ level: 2, status: "CURRENT", revealedWord: null });
    expect(levels.slice(2).every((level) => level.status === "LOCKED")).toBe(true);
  });

  it("keeps the levels below the current one completed", () => {
    const { levels, currentLevel } = deriveProgress(won([1, 2]));

    expect(currentLevel).toBe(3);
    expect(levels.slice(0, 2).every((level) => level.status === "COMPLETED")).toBe(true);
    expect(levels[2]?.status).toBe("CURRENT");
  });

  it("targets the lowest unbeaten level when a higher one is somehow beaten", () => {
    // Not reachable through the API, which refuses to skip ahead, but the rule
    // is "lowest unbeaten" and this is what that means.
    const { levels, currentLevel } = deriveProgress(won([1, 3]));

    expect(currentLevel).toBe(2);
    expect(levels[1]?.status).toBe("CURRENT");
    expect(levels[2]?.status).toBe("COMPLETED");
  });

  it("marks everything completed and nothing current when all three are beaten", () => {
    const { levels, currentLevel, everyLevelBeaten } = deriveProgress(won(ALL_LEVELS));

    expect(everyLevelBeaten).toBe(true);
    expect(currentLevel).toBe(MAX_LEVEL);
    expect(levels.every((level) => level.status === "COMPLETED")).toBe(true);
    expect(levels.map((level) => level.revealedWord)).toEqual(
      ALL_LEVELS.map((level) => `BTB{level-${level}}`),
    );
  });

  it("never reveals a flag for a level that has not been beaten", () => {
    const { levels } = deriveProgress(won([1, 2]));

    expect(levels[1]?.revealedWord).toBe("BTB{level-2}");
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
      select: {
        level: true,
        flag: { select: { value: true } },
        word: { select: { text: true } },
      },
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
      ALL_LEVELS.map((level) => ({
        level,
        flag: { value: `BTB{level-${level}}` },
        word: null,
      })),
    );

    const progress = await getProgress("user_1");

    expect(progress.currentLevel).toBe(MAX_LEVEL);
    expect(progress.session).toBeNull();
    expect(progress.levels.every((level) => level.status === "COMPLETED")).toBe(true);
    // Nothing is CURRENT, so there is no reason to look for a live session.
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("still resolves a legacy word-era won session through the fallback", async () => {
    mocks.findMany.mockResolvedValue([{ level: 1, flag: null, word: { text: "compass" } }]);
    mocks.findFirst.mockResolvedValue(null);

    const progress = await getProgress("user_1");

    expect(progress.levels[0]).toEqual({
      level: 1,
      status: "COMPLETED",
      revealedWord: "compass",
    });
  });

  it("ignores a stored level the game does not have", async () => {
    mocks.findMany.mockResolvedValue([
      { level: 99, flag: { value: "BTB{nonsense}" }, word: null },
    ]);
    mocks.findFirst.mockResolvedValue(null);

    const progress = await getProgress("user_1");

    expect(progress.currentLevel).toBe(1);
    expect(progress.levels.every((level) => level.status !== "COMPLETED")).toBe(true);
  });
});

describe("submitFlag", () => {
  const FLAG = "BTB{11111111-2222-3333-4444-555555555555}";
  const SESSION_ID = "session_1";

  /** A live session row as `SESSION_INCLUDE` returns it. */
  function liveSession(overrides: Record<string, unknown> = {}) {
    return {
      id: SESSION_ID,
      level: 1,
      status: "IN_PROGRESS",
      flagged: false,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      endedAt: null,
      flag: { value: FLAG },
      word: null,
      attempts: [],
      ...overrides,
    };
  }

  beforeEach(() => {
    mocks.findFirst.mockReset();
    mocks.update.mockReset();
  });

  it("scopes the lookup to the caller's own session", async () => {
    mocks.findFirst.mockResolvedValue(liveSession());
    mocks.update.mockResolvedValue(liveSession({ status: "WON", endedAt: new Date() }));

    await submitFlag("user_1", SESSION_ID, FLAG);

    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SESSION_ID, userId: "user_1" } }),
    );
  });

  it("returns null when there is no session for this caller", async () => {
    mocks.findFirst.mockResolvedValue(null);

    expect(await submitFlag("user_1", SESSION_ID, FLAG)).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("returns null when the session is already finished", async () => {
    mocks.findFirst.mockResolvedValue(liveSession({ status: "WON" }));

    expect(await submitFlag("user_1", SESSION_ID, FLAG)).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("returns correct:false for a wrong guess and never ends the session", async () => {
    mocks.findFirst.mockResolvedValue(liveSession());

    const result = await submitFlag("user_1", SESSION_ID, "BTB{not-the-flag}");

    expect(result).toEqual({ correct: false });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("treats a decoy with a different body as wrong", async () => {
    mocks.findFirst.mockResolvedValue(liveSession());

    const result = await submitFlag(
      "user_1",
      SESSION_ID,
      "BTB{99999999-8888-7777-6666-555555555555}",
    );

    expect(result).toEqual({ correct: false });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("marks the session WON and reveals the flag on an exact match", async () => {
    mocks.findFirst.mockResolvedValue(liveSession());
    mocks.update.mockResolvedValue(liveSession({ status: "WON", endedAt: new Date() }));

    const result = await submitFlag("user_1", SESSION_ID, FLAG);

    expect(result).toEqual({ correct: true, session: expect.objectContaining({ status: "WON" }) });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: SESSION_ID },
      data: { status: "WON", endedAt: expect.any(Date) },
      include: expect.anything(),
    });
    if (result?.correct) {
      expect(result.session.revealedWord).toBe(FLAG);
    }
  });

  it("matches despite surrounding whitespace and case, so a pasted flag still wins", async () => {
    mocks.findFirst.mockResolvedValue(liveSession());
    mocks.update.mockResolvedValue(liveSession({ status: "WON", endedAt: new Date() }));

    const result = await submitFlag("user_1", SESSION_ID, `  ${FLAG.toUpperCase()}  `);

    expect(result?.correct).toBe(true);
  });
});
