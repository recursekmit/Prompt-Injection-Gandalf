import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubmitFlagResult } from "@/lib/game/session-service";
import type { SessionDto } from "@/lib/types";

/**
 * Route-level suite for the flag endpoint — the only win path.
 *
 * `auth` and `submitFlag` are stubbed: the route's job is to map their verdicts
 * onto HTTP, not to compute them. `submitFlag`'s own logic (exact match, decoy
 * rejection, WON transition) is pinned in the session-service suite.
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn<() => Promise<{ user: { id: string } } | null>>(),
  submitFlag:
    vi.fn<(userId: string, sessionId: string, guess: string) => Promise<SubmitFlagResult | null>>(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/game/session-service", () => ({ submitFlag: mocks.submitFlag }));

import { POST } from "./route";

const USER_ID = "user_1";
const SESSION_ID = "session_1";
const FLAG = "BTB{11111111-2222-3333-4444-555555555555}";
const PARAMS = { params: Promise.resolve({ id: SESSION_ID }) };

/** A WON session as `submitFlag` returns it on a correct guess. */
const WON_SESSION: SessionDto = {
  id: SESSION_ID,
  level: 1,
  status: "WON",
  attemptCount: 3,
  flagged: false,
  startedAt: "2026-01-01T00:00:00.000Z",
  endedAt: "2026-01-01T00:05:00.000Z",
  attempts: [],
  revealedWord: FLAG,
};

function post(body: string): Request {
  return new Request(`http://localhost/api/session/${SESSION_ID}/flag`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

function claim(flag: unknown): Promise<Response> {
  return POST(post(JSON.stringify({ flag })), PARAMS);
}

describe("POST /api/session/[id]/flag", () => {
  beforeEach(() => {
    mocks.auth.mockReset();
    mocks.submitFlag.mockReset();
    mocks.auth.mockResolvedValue({ user: { id: USER_ID } });
  });

  it("answers 401 and never touches the session when the caller is signed out", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await claim(FLAG);

    expect(response.status).toBe(401);
    expect(mocks.submitFlag).not.toHaveBeenCalled();
  });

  it("answers 400 for a non-JSON body", async () => {
    const response = await POST(post("not json"), PARAMS);

    expect(response.status).toBe(400);
    expect(mocks.submitFlag).not.toHaveBeenCalled();
  });

  it("answers 400 when the flag is missing or blank", async () => {
    const missing = await POST(post(JSON.stringify({})), PARAMS);
    const blank = await claim("   ");
    const wrongType = await claim(42);

    expect(missing.status).toBe(400);
    expect(blank.status).toBe(400);
    expect(wrongType.status).toBe(400);
    expect(mocks.submitFlag).not.toHaveBeenCalled();
  });

  it("answers 409 when there is no live session to submit to", async () => {
    mocks.submitFlag.mockResolvedValue(null);

    const response = await claim(FLAG);

    expect(response.status).toBe(409);
    expect(mocks.submitFlag).toHaveBeenCalledWith(USER_ID, SESSION_ID, FLAG);
  });

  it("returns correct:false as a plain 200 for a wrong guess, keeping the session open", async () => {
    mocks.submitFlag.mockResolvedValue({ correct: false });

    const response = await claim("BTB{wrong}");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      correct: false,
      status: "IN_PROGRESS",
      session: null,
      revealedWord: null,
    });
  });

  it("returns the won session and the flag on a correct guess", async () => {
    mocks.submitFlag.mockResolvedValue({ correct: true, session: WON_SESSION });

    const response = await claim(FLAG);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      correct: true,
      status: "WON",
      session: WON_SESSION,
      revealedWord: FLAG,
    });
  });
});
