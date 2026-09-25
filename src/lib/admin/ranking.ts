import { LEVELS } from "@/lib/guardian/levels";
import type { LeaderboardLevelCell, LeaderboardLevelSummary, LeaderboardRow, LevelNumber } from "@/lib/types";

/**
 * The leaderboard's ranking, as pure functions over plain rows.
 *
 * Deliberately separate from `leaderboard.ts`, which reads the database: the
 * order IS the feature, and a scoreboard is read by its tie breaks as much as
 * by its top row. Keeping that logic here means the tie breaks can be tested
 * directly, with no database, no environment and no query in the way.
 *
 * Order, agreed with the owner: levels completed, then fewest total attempts.
 *   1. levelsCompleted descending — the point of the game.
 *   2. totalAttempts ascending — the cost of getting there. Attempts at levels
 *      already won, and in abandoned sessions, count: they are what the player
 *      spent, and a player who brute-forces has bought their rank dearly.
 *   3. lastWinAt ascending — earliest to reach that record.
 *   4. email ascending — a total order. Without it, two players on identical
 *      records can swap places between two refreshes of the same page, and a
 *      leaderboard that reshuffles itself is worse than one ordered arbitrarily.
 *
 * `levelsCompleted` counts DISTINCT won levels, so a level won twice is one
 * level. Players with no attempts are excluded — they have not started, and a
 * board where most rows are empty is unreadable; the count is returned instead.
 */

/** Structurally the Prisma `SessionStatus`, restated so this module stays free
 * of generated types and can be imported without a database. */
export type RankSessionStatus = "IN_PROGRESS" | "WON" | "ABANDONED";

export interface RankPlayer {
  readonly id: string;
  readonly email: string;
}

export interface RankSession {
  readonly id: string;
  readonly userId: string;
  readonly level: number;
  readonly status: RankSessionStatus;
  readonly createdAt: Date;
  readonly endedAt: Date | null;
}

export interface RankInput {
  readonly players: readonly RankPlayer[];
  readonly sessions: readonly RankSession[];
  /** Attempt count per session id. Sessions absent from the map have none. */
  readonly attemptsBySession: ReadonlyMap<string, number>;
}

export interface RankResult {
  readonly rows: LeaderboardRow[];
  /** Players with no attempts at all, left off the board. */
  readonly playersExcluded: number;
}

/** The levels the board shows columns for, in order. */
export const LEADERBOARD_LEVELS: readonly LevelNumber[] = LEVELS.map(
  (definition) => definition.level,
);

/** Milliseconds for sorting; a missing win sorts after every real one. */
function winTime(row: { lastWinAt: string | null }): number {
  return row.lastWinAt === null ? Number.POSITIVE_INFINITY : Date.parse(row.lastWinAt);
}

function compare(a: LeaderboardRow, b: LeaderboardRow): number {
  if (a.levelsCompleted !== b.levelsCompleted) {
    return b.levelsCompleted - a.levelsCompleted;
  }
  if (a.totalAttempts !== b.totalAttempts) {
    return a.totalAttempts - b.totalAttempts;
  }
  const byTime = winTime(a) - winTime(b);
  if (byTime !== 0) {
    return byTime;
  }
  return a.email < b.email ? -1 : a.email > b.email ? 1 : 0;
}

export function rankPlayers(input: RankInput): RankResult {
  const byPlayer = new Map<
    string,
    {
      levelsWon: Set<number>;
      attemptsByLevel: Map<number, number>;
      totalAttempts: number;
      lastWinAt: Date | null;
    }
  >();

  for (const player of input.players) {
    byPlayer.set(player.id, {
      levelsWon: new Set<number>(),
      attemptsByLevel: new Map<number, number>(),
      totalAttempts: 0,
      lastWinAt: null,
    });
  }

  for (const session of input.sessions) {
    const player = byPlayer.get(session.userId);
    if (player === undefined) {
      continue;
    }

    const attempts = input.attemptsBySession.get(session.id) ?? 0;
    player.totalAttempts += attempts;
    player.attemptsByLevel.set(
      session.level,
      (player.attemptsByLevel.get(session.level) ?? 0) + attempts,
    );

    if (session.status === "WON") {
      player.levelsWon.add(session.level);
      // The session's own end, falling back to its start: a WON row is written
      // in the same transaction as the winning attempt, so a null `endedAt` on a
      // won session would be a bug elsewhere — not a case to drop the player for.
      const wonAt = session.endedAt ?? session.createdAt;
      if (player.lastWinAt === null || wonAt > player.lastWinAt) {
        player.lastWinAt = wonAt;
      }
    }
  }

  const rows: LeaderboardRow[] = [];
  let playersExcluded = 0;

  for (const player of input.players) {
    const record = byPlayer.get(player.id);
    if (record === undefined || record.totalAttempts === 0) {
      playersExcluded += 1;
      continue;
    }

    const levels: LeaderboardLevelCell[] = LEADERBOARD_LEVELS.map((level) => ({
      level,
      won: record.levelsWon.has(level),
      attempts: record.attemptsByLevel.get(level) ?? 0,
    }));

    rows.push({
      rank: 0, // assigned below, once the order is final
      email: player.email,
      levelsCompleted: record.levelsWon.size,
      totalAttempts: record.totalAttempts,
      lastWinAt: record.lastWinAt === null ? null : record.lastWinAt.toISOString(),
      levels,
    });
  }

  rows.sort(compare);
  rows.forEach((row, index) => {
    row.rank = index + 1;
  });

  return { rows, playersExcluded };
}

export function summariseLevels(
  rows: readonly LeaderboardRow[],
): LeaderboardLevelSummary[] {
  return LEADERBOARD_LEVELS.map((level) => {
    let won = 0;
    let attempted = 0;

    for (const row of rows) {
      const cell = row.levels.find((candidate) => candidate.level === level);
      if (cell === undefined || cell.attempts === 0) {
        continue;
      }
      attempted += 1;
      if (cell.won) {
        won += 1;
      }
    }

    return { level, won, attempted };
  });
}
