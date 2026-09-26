import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LevelNumber, LevelProgressDto, ProgressResponse } from "@/lib/types";

/**
 * Route-level suite for `GET /api/session/current`.
 *
 * The handler is thin — a 401 and a passthrough — but the shape it passes
 * through is the contract the reload path depends on, so the fixture is built
 * by the REAL `deriveProgress` rather than hand-written, and the assertion is
 * on the JSON the route actually returned: levels ascending, one CURRENT,
 * COMPLETED before it, LOCKED after it, a flag revealed only on a beaten level.
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn<() => Promise<{ user: { id: string } } | null>>(),
  getProgress: vi.fn<(userId: string) => Promise<ProgressResponse>>(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));

vi.mock("@/lib/game/session-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/game/session-service")>();
  return { ...actual, getProgress: mocks.getProgress };
});

// Keeps the real Prisma client, and therefore `@/lib/env`'s fail-fast
// validation, out of the import graph.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { deriveProgress } = await import("@/lib/game/session-service");
const { GET } = await import("@/app/api/session/current/route");

const USER_ID = "user_1";

/** The response the service produces for a set of beaten levels. */
function progressForBeaten(beaten: ReadonlyMap<LevelNumber, string>): ProgressResponse {
  const { levels, currentLevel } = deriveProgress(beaten);
  return { levels, currentLevel, session: null };
}

const ALL_THREE = new Map([
  [1, "BTB{compass}"],
  [2, "BTB{lantern}"],
  [3, "BTB{crucible}"],
]) as ReadonlyMap<LevelNumber, string>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: USER_ID } });
  mocks.getProgress.mockResolvedValue(progressForBeaten(new Map()));
});

describe("GET /api/session/current", () => {
  it("answers 401 when signed out, without reading progress", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Not signed in." });
    expect(mocks.getProgress).not.toHaveBeenCalled();
  });

  it("returns the caller's own progression", async () => {
    await GET();

    expect(mocks.getProgress).toHaveBeenCalledWith(USER_ID);
  });

  it("returns three levels in ascending order, one current, the rest locked", async () => {
    mocks.getProgress.mockResolvedValue(
      progressForBeaten(new Map([[1, "BTB{compass}"]])),
    );

    const response = await GET();
    const body = (await response.json()) as ProgressResponse;

    expect(response.status).toBe(200);
    expect(body.levels.map((level) => level.level)).toEqual([1, 2, 3]);
    expect(body.levels.map((level) => level.status)).toEqual([
      "COMPLETED",
      "CURRENT",
      "LOCKED",
    ]);
    expect(body.currentLevel).toBe(2);
    expect(body.session).toBeNull();
  });

  it("reveals a flag only for a beaten level", async () => {
    mocks.getProgress.mockResolvedValue(progressForBeaten(new Map([[1, "BTB{compass}"]])));

    const body = (await (await GET()).json()) as ProgressResponse;
    const revealed = body.levels.map((level: LevelProgressDto) => level.revealedWord);

    expect(revealed).toEqual(["BTB{compass}", null, null]);
  });

  it("returns the live session when one is in progress", async () => {
    const session = {
      id: "session_1",
      level: 2 as const,
      status: "IN_PROGRESS" as const,
      attemptCount: 2,
      flagged: false,
      startedAt: "2026-09-25T00:00:00.000Z",
      endedAt: null,
      attempts: [],
      revealedWord: null,
    };
    mocks.getProgress.mockResolvedValue({
      ...progressForBeaten(new Map([[1, "BTB{compass}"]])),
      session,
    });

    const body = (await (await GET()).json()) as ProgressResponse;

    expect(body.session).toEqual(session);
  });

  it("has every level COMPLETED and no session once all three are beaten", async () => {
    mocks.getProgress.mockResolvedValue(progressForBeaten(ALL_THREE));

    const body = (await (await GET()).json()) as ProgressResponse;

    expect(body.levels.map((level) => level.status)).toEqual([
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
    ]);
    // Nothing is CURRENT: there is no next level, and no live session to resume.
    expect(body.session).toBeNull();
  });
});
