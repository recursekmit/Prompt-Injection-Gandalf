import { loadLeaderboard } from "@/lib/admin/leaderboard";
import type { PublicLeaderboardResponse } from "@/lib/types";

/**
 * The public leaderboard: the same ranking the console uses, with email dropped.
 *
 * The strip happens here, once, by constructing each public row field by field
 * rather than spreading the admin row — so email is *absent* from the object,
 * not merely un-rendered. A logged-out visitor's browser never receives it. If
 * a new PII field is ever added to `LeaderboardRow`, this mapping keeps it out
 * of the public payload by omission unless it is deliberately added below.
 */
export async function loadPublicLeaderboard(): Promise<PublicLeaderboardResponse> {
  const { rows, summary, playersExcluded, playersTotal } = await loadLeaderboard();

  return {
    rows: rows.map((row) => ({
      rank: row.rank,
      name: row.name,
      rollNumber: row.rollNumber,
      levelsCompleted: row.levelsCompleted,
      totalAttempts: row.totalAttempts,
      lastWinAt: row.lastWinAt,
      levels: row.levels,
    })),
    summary,
    playersExcluded,
    playersTotal,
  };
}
