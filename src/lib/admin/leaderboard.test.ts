import { describe, expect, it } from "vitest";

import { rankPlayers, summariseLevels } from "@/lib/admin/ranking";
import type { RankPlayer, RankSession } from "@/lib/admin/ranking";

/**
 * The order is the feature, so these assert the WHOLE ordering rather than the
 * top row: a wrong tie break shows up at position four, not position one, and a
 * test that only reads `rows[0]` would pass while the board was wrong.
 */

const A = { id: "u-a", email: "ada@example.com", name: null, rollNumber: null };
const B = { id: "u-b", email: "bob@example.com", name: null, rollNumber: null };
const C = { id: "u-c", email: "cy@example.com", name: null, rollNumber: null };
const D = { id: "u-d", email: "dee@example.com", name: null, rollNumber: null };

let sessionCounter = 0;

function session(
  userId: string,
  level: number,
  status: RankSession["status"],
  options: { readonly attempts?: number; readonly endedAt?: Date | null } = {},
): { session: RankSession; attempts: number } {
  sessionCounter += 1;
  const createdAt = new Date("2026-09-25T10:00:00.000Z");
  return {
    session: {
      id: `s-${sessionCounter}`,
      userId,
      level,
      status,
      createdAt,
      endedAt: status === "WON" ? (options.endedAt ?? new Date("2026-09-25T11:00:00.000Z")) : null,
    },
    attempts: options.attempts ?? 1,
  };
}

/** Builds the inputs, wiring each session's attempt count into the map. */
function rank(
  players: readonly RankPlayer[],
  built: ReadonlyArray<{ session: RankSession; attempts: number }>,
) {
  return rankPlayers({
    players,
    sessions: built.map((entry) => entry.session),
    attemptsBySession: new Map(built.map((entry) => [entry.session.id, entry.attempts])),
  });
}

function emails(rows: readonly { email: string }[]): string[] {
  return rows.map((row) => row.email);
}

describe("rankPlayers", () => {
  it("ranks by levels completed before attempts", () => {
    // Bob has more wins but also far more attempts; he still outranks Ada.
    const result = rank(
      [A, B],
      [
        session("u-a", 1, "WON", { attempts: 1 }),
        session("u-b", 1, "WON", { attempts: 40 }),
        session("u-b", 2, "WON", { attempts: 40 }),
      ],
    );

    expect(emails(result.rows)).toEqual(["bob@example.com", "ada@example.com"]);
    expect(result.rows.map((row) => row.rank)).toEqual([1, 2]);
  });

  it("breaks a tie on levels with the fewest total attempts", () => {
    const result = rank(
      [A, B],
      [
        session("u-a", 1, "WON", { attempts: 9 }),
        session("u-b", 1, "WON", { attempts: 2 }),
      ],
    );

    expect(emails(result.rows)).toEqual(["bob@example.com", "ada@example.com"]);
  });

  it("counts attempts in abandoned sessions and at already-won levels", () => {
    // Ada wins level 1 cheaply, then burns attempts on a level she abandons.
    const result = rank(
      [A, B],
      [
        session("u-a", 1, "WON", { attempts: 1 }),
        session("u-a", 2, "ABANDONED", { attempts: 30 }),
        session("u-b", 1, "WON", { attempts: 3 }),
      ],
    );

    // Same levels completed, but Ada spent 31 attempts to Bob's 3.
    expect(emails(result.rows)).toEqual(["bob@example.com", "ada@example.com"]);
    expect(result.rows[1]?.totalAttempts).toBe(31);
  });

  it("counts a level won twice as one level", () => {
    const result = rank(
      [A],
      [
        session("u-a", 1, "WON", { attempts: 2 }),
        session("u-a", 1, "WON", { attempts: 5 }),
      ],
    );

    expect(result.rows[0]?.levelsCompleted).toBe(1);
    expect(result.rows[0]?.totalAttempts).toBe(7);
  });

  it("breaks a remaining tie on who reached the record first", () => {
    const result = rank(
      [A, B],
      [
        session("u-a", 1, "WON", { attempts: 4, endedAt: new Date("2026-09-25T12:00:00.000Z") }),
        session("u-b", 1, "WON", { attempts: 4, endedAt: new Date("2026-09-25T11:00:00.000Z") }),
      ],
    );

    expect(emails(result.rows)).toEqual(["bob@example.com", "ada@example.com"]);
  });

  it("breaks a total tie on email, so the order never moves between refreshes", () => {
    const sameRecord = [
      session("u-c", 1, "WON", { attempts: 4, endedAt: new Date("2026-09-25T11:00:00.000Z") }),
      session("u-d", 1, "WON", { attempts: 4, endedAt: new Date("2026-09-25T11:00:00.000Z") }),
    ];

    const forward = rank([C, D], sameRecord).rows;
    const reversed = rank([D, C], sameRecord).rows;

    expect(emails(forward)).toEqual(["cy@example.com", "dee@example.com"]);
    // Same answer whichever order the rows arrive in, which is the property.
    expect(emails(reversed)).toEqual(emails(forward));
  });

  it("leaves out players with no attempts and counts them", () => {
    const result = rank(
      [A, B, C],
      [session("u-a", 1, "WON", { attempts: 3 })],
    );

    expect(emails(result.rows)).toEqual(["ada@example.com"]);
    expect(result.playersExcluded).toBe(2);
  });

  it("ignores sessions belonging to an unknown player", () => {
    const result = rank([A], [session("u-ghost", 1, "WON", { attempts: 5 })]);

    expect(result.rows).toHaveLength(0);
    expect(result.playersExcluded).toBe(1);
  });

  it("reports per-level attempts and wins, for the columns", () => {
    const result = rank(
      [A],
      [
        session("u-a", 1, "WON", { attempts: 2 }),
        session("u-a", 3, "ABANDONED", { attempts: 6 }),
      ],
    );

    expect(result.rows[0]?.levels).toEqual([
      { level: 1, won: true, attempts: 2 },
      { level: 2, won: false, attempts: 0 },
      { level: 3, won: false, attempts: 6 },
      { level: 4, won: false, attempts: 0 },
      { level: 5, won: false, attempts: 0 },
      { level: 6, won: false, attempts: 0 },
    ]);
  });

  it("returns an empty board for no players at all", () => {
    const result = rank([], []);

    expect(result.rows).toEqual([]);
    expect(result.playersExcluded).toBe(0);
  });
});

describe("summariseLevels", () => {
  it("counts winners and triers per level", () => {
    const { rows } = rank(
      [A, B, C],
      [
        session("u-a", 1, "WON", { attempts: 2 }),
        session("u-b", 1, "ABANDONED", { attempts: 4 }),
        session("u-a", 2, "ABANDONED", { attempts: 1 }),
      ],
    );

    const summary = summariseLevels(rows);

    expect(summary[0]).toEqual({ level: 1, won: 1, attempted: 2 });
    expect(summary[1]).toEqual({ level: 2, won: 0, attempted: 1 });
    expect(summary[2]).toEqual({ level: 3, won: 0, attempted: 0 });
    expect(summary).toHaveLength(6);
  });
});
