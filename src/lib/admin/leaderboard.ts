import { prisma } from "@/lib/prisma";
import { rankPlayers, summariseLevels } from "@/lib/admin/ranking";
import type { LeaderboardResponse } from "@/lib/types";

/**
 * The leaderboard's data, read from the database and ranked by
 * `@/lib/admin/ranking`.
 *
 * `rankPlayers` is a separate module on purpose: the ordering is the feature and
 * is tested there without a database. This file only does the reading.
 *
 * Three queries, joined in memory. Never `include` attempts on a session here:
 * at the event's scale that is 150 players times six levels of attempt rows in
 * one payload, which is the query that turns a leaderboard into a slow screen.
 */
export async function loadLeaderboard(): Promise<LeaderboardResponse> {
  const [players, sessions, attemptCounts] = await Promise.all([
    prisma.user.findMany({ select: { id: true, email: true } }),
    prisma.gameSession.findMany({
      select: {
        id: true,
        userId: true,
        level: true,
        status: true,
        createdAt: true,
        endedAt: true,
      },
    }),
    prisma.attempt.groupBy({ by: ["sessionId"], _count: { _all: true } }),
  ]);

  const attemptsBySession = new Map<string, number>(
    attemptCounts.map((entry) => [entry.sessionId, entry._count._all]),
  );

  const { rows, playersExcluded } = rankPlayers({ players, sessions, attemptsBySession });

  return {
    rows,
    summary: summariseLevels(rows),
    playersExcluded,
    playersTotal: players.length,
  };
}
