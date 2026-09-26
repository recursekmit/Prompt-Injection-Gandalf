import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LevelNumber, LevelProgressDto, ProgressResponse, SessionDto } from "@/lib/types";

/**
 * Route-level suite for `POST /api/session/start` — the handler that enforces
 * "no skipping ahead, no replaying a beaten level".
 *
 * `auth`, `getProgress` and `startOrResumeSession` are stubbed; the route's job
 * is to turn their verdicts into status codes, and the progression rule itself
 * is tested where it lives, in `session-service.test.ts`.
 *
 * `NoWordsAvailableError` is the REAL class (only the two functions are
 * replaced), because the route's `instanceof` compares against its own import:
 * a hand-rolled lookalike would make the 503 branch untestable.
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn<() => Promise<{ user: { id: string } } | null>>(),
  getProgress: vi.fn<(userId: string) => Promise<ProgressResponse>>(),
  startOrResumeSession: vi.fn<(userId: string, level: number) => Promise<SessionDto>>(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));

vi.mock("@/lib/game/session-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/game/session-service")>();
  return {
    ...actual,
    getProgress: mocks.getProgress,
    startOrResumeSession: mocks.startOrResumeSession,
  };
});

// Keeps the real Prisma client, and therefore `@/lib/env`'s fail-fast
// validation, out of the import graph.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { NoWordsAvailableError } = await import("@/lib/game/session-service");
const { POST } = await import("@/app/api/session/start/route");

const USER_ID = "user_1";
const SESSION_ID = "session_1";

const SESSION: SessionDto = {
  id: SESSION_ID,
  level: 3,
  status: "IN_PROGRESS",
  attemptCount: 0,
  flagged: false,
  startedAt: "2026-09-25T00:00:00.000Z",
  endedAt: null,
  attempts: [],
  revealedWord: null,
};

/**
 * A progression with `beaten` levels COMPLETED, the lowest unbeaten one
 * CURRENT, and the rest LOCKED — the same rule the service derives, restated so
 * this suite fails if the route stops depending on it.
 */
function progress(beaten: number, liveSession: SessionDto | null = null): ProgressResponse {
  const levels: LevelProgressDto[] = [1, 2, 3].map((level) => ({
    level: level as LevelNumber,
    status: level <= beaten ? "COMPLETED" : level === beaten + 1 ? "CURRENT" : "LOCKED",
    revealedWord: level <= beaten ? `BTB{word${level}}` : null,
  }));
  return {
    levels,
    currentLevel: Math.min(beaten + 1, 3) as LevelNumber,
    session: liveSession,
  };
}

function start(body: unknown = { level: 1 }, raw?: string): Promise<Response> {
  return POST(
    new Request("http://localhost/api/session/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ?? JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: USER_ID } });
  mocks.getProgress.mockResolvedValue(progress(0));
  mocks.startOrResumeSession.mockResolvedValue(SESSION);
});

describe("POST /api/session/start", () => {
  it("answers 401 when signed out, without reading progress", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await start();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Not signed in." });
    expect(mocks.getProgress).not.toHaveBeenCalled();
    expect(mocks.startOrResumeSession).not.toHaveBeenCalled();
  });

  it("answers 400 for a body that is not JSON", async () => {
    const response = await start(undefined, "not json at all");

    expect(response.status).toBe(400);
    expect(mocks.getProgress).not.toHaveBeenCalled();
  });

  it.each([
    ["zero", 0],
    ["one above the maximum", 4],
    ["a fraction", 1.5],
    ["a numeric string", "1"],
    ["null", null],
    ["a missing level", undefined],
  ])("answers 400 when the level is %s", async (_label, level) => {
    const response = await start({ level });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "A level number from 1 to 3 is required.",
    });
    // Refused before any progression read: nothing to compare, nothing to start.
    expect(mocks.getProgress).not.toHaveBeenCalled();
    expect(mocks.startOrResumeSession).not.toHaveBeenCalled();
  });

  it("answers 409 for a level above the current one", async () => {
    mocks.getProgress.mockResolvedValue(progress(1));

    const response = await start({ level: 3 });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "That level is locked. Beat level 2 first.",
    });
    expect(mocks.startOrResumeSession).not.toHaveBeenCalled();
  });

  it("answers 409 for a level already beaten", async () => {
    mocks.getProgress.mockResolvedValue(progress(2));

    const response = await start({ level: 1 });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "You have already beaten that level." });
    expect(mocks.startOrResumeSession).not.toHaveBeenCalled();
  });

  it("answers 409 once every level is beaten", async () => {
    // currentLevel is the last level and it is itself beaten, so this state is
    // only distinguishable by the all-COMPLETED check, which must run first.
    mocks.getProgress.mockResolvedValue(progress(3));

    const response = await start({ level: 3 });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "You have beaten every level." });
    expect(mocks.startOrResumeSession).not.toHaveBeenCalled();
  });

  it("starts the current level and returns the session", async () => {
    mocks.getProgress.mockResolvedValue(progress(2));

    const response = await start({ level: 3 });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ session: SESSION });
    expect(mocks.startOrResumeSession).toHaveBeenCalledWith(USER_ID, 3);
  });

  it("returns the resumed session rather than a new one", async () => {
    // A reload asks for whatever level the page shows; the live session wins.
    mocks.getProgress.mockResolvedValue(progress(2, SESSION));
    mocks.startOrResumeSession.mockResolvedValue(SESSION);

    const response = await start({ level: 3 });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ session: SESSION });
  });

  it("answers 503 when the level has no active flag", async () => {
    mocks.startOrResumeSession.mockRejectedValue(new NoWordsAvailableError(1));

    const response = await start({ level: 1 });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "No words are available at that level yet.",
    });
  });

  it("answers 500 for an unexpected failure and logs it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.startOrResumeSession.mockRejectedValue(new Error("database is on fire"));

    const response = await start({ level: 1 });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Could not start a session." });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
