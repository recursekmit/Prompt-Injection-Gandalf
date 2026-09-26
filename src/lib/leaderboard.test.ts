import { describe, expect, it, vi } from "vitest";

const { loadLeaderboardMock } = vi.hoisted(() => ({
  loadLeaderboardMock: vi.fn(),
}));

vi.mock("@/lib/admin/leaderboard", () => ({
  loadLeaderboard: loadLeaderboardMock,
}));

import { loadPublicLeaderboard } from "./leaderboard";

describe("loadPublicLeaderboard", () => {
  it("drops email from every row and never serialises it", async () => {
    loadLeaderboardMock.mockResolvedValue({
      rows: [
        {
          rank: 1,
          email: "ada@example.com",
          name: "Ada",
          rollNumber: "21BD1A0501",
          levelsCompleted: 2,
          totalAttempts: 5,
          lastWinAt: "2026-09-25T11:00:00.000Z",
          levels: [{ level: 1, won: true, attempts: 2 }],
        },
      ],
      summary: [],
      playersExcluded: 3,
      playersTotal: 4,
    });

    const result = await loadPublicLeaderboard();
    const row = result.rows[0];

    expect(row).not.toHaveProperty("email");
    expect(row).toMatchObject({ rank: 1, name: "Ada", rollNumber: "21BD1A0501" });
    // The hard guarantee: email must not appear anywhere in the wire payload.
    expect(JSON.stringify(result)).not.toContain("ada@example.com");
    expect(result.playersTotal).toBe(4);
  });
});
