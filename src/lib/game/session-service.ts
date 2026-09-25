import { prisma } from "@/lib/prisma";
import type { SessionDto, Tier } from "@/lib/types";

/**
 * Word assignment and session lifecycle.
 *
 * Two invariants this module exists to hold:
 *   1. A player has at most one IN_PROGRESS session. A partial unique index in
 *      the database enforces it, and `startSession` recovers from the race by
 *      returning the session that won.
 *   2. A word is never assigned twice to the same player *within a cycle*. When
 *      every word in a tier has been used, the cycle increments and the tier
 *      recycles, preferring words the player has never won. Putting the cycle on
 *      the session rather than the player keeps the history intact, so a future
 *      leaderboard still sees every past attempt.
 */

/** Thrown when a tier has no active words at all — a seed problem, not a player problem. */
export class NoWordsAvailableError extends Error {
  constructor(tier: Tier) {
    super(`No active words available in tier ${tier}`);
    this.name = "NoWordsAvailableError";
  }
}

interface SessionRow {
  id: string;
  tier: Tier;
  status: "IN_PROGRESS" | "WON" | "ABANDONED";
  flagged: boolean;
  createdAt: Date;
  endedAt: Date | null;
  word: { text: string };
  attempts: ReadonlyArray<{
    id: string;
    userMessage: string;
    aiResponse: string;
    leaked: boolean;
    createdAt: Date;
  }>;
}

/**
 * The only place a session becomes a DTO. The word's text is included ONLY when
 * the session has been won: while it is in progress, sending it would put the
 * answer in the browser's network tab and end the game.
 */
export function toSessionDto(session: SessionRow): SessionDto {
  return {
    id: session.id,
    tier: session.tier,
    status: session.status,
    attemptCount: session.attempts.length,
    flagged: session.flagged,
    startedAt: session.createdAt.toISOString(),
    endedAt: session.endedAt === null ? null : session.endedAt.toISOString(),
    attempts: session.attempts.map((attempt) => ({
      id: attempt.id,
      userMessage: attempt.userMessage,
      aiResponse: attempt.aiResponse,
      leaked: attempt.leaked,
      createdAt: attempt.createdAt.toISOString(),
    })),
    revealedWord: session.status === "WON" ? session.word.text : null,
  };
}

const SESSION_INCLUDE = {
  word: { select: { text: true } },
  attempts: { orderBy: { createdAt: "asc" } },
} as const;

/** The player's live session, whatever tier it belongs to, or null. */
export async function getActiveSessionDto(userId: string): Promise<SessionDto | null> {
  const session = await prisma.gameSession.findFirst({
    where: { userId, status: "IN_PROGRESS" },
    include: SESSION_INCLUDE,
  });
  return session === null ? null : toSessionDto(session);
}

/**
 * Picks the word for a new session. Pure, so the recycle rule can be tested
 * without a database.
 *
 * Returns null only when the tier has no active words.
 */
export function chooseWord(
  candidates: ReadonlyArray<{ id: string; text: string }>,
  wonWordIds: ReadonlySet<string>,
  random: () => number = Math.random,
): { id: string; text: string } | null {
  if (candidates.length === 0) {
    return null;
  }
  const neverWon = candidates.filter((word) => !wonWordIds.has(word.id));
  // Prefer words the player has never beaten; fall back to the whole candidate
  // set so a tier that has been fully beaten is still playable.
  const pool = neverWon.length > 0 ? neverWon : candidates;
  const index = Math.floor(random() * pool.length);
  return pool[index] ?? null;
}

/**
 * Returns the player's live session, or creates one at the requested tier.
 *
 * Resuming ignores the requested tier on purpose: a player who reloads and
 * happens to have a different tier selected must still get their session back.
 */
export async function startOrResumeSession(userId: string, tier: Tier): Promise<SessionDto> {
  const existing = await getActiveSessionDto(userId);
  if (existing !== null) {
    return existing;
  }

  const activeWords = await prisma.word.findMany({
    where: { tier, active: true },
    select: { id: true, text: true },
  });
  if (activeWords.length === 0) {
    throw new NoWordsAvailableError(tier);
  }

  const highest = await prisma.gameSession.aggregate({
    where: { userId, tier },
    _max: { cycle: true },
  });
  let cycle = highest._max.cycle ?? 0;

  const assignedThisCycle = await prisma.gameSession.findMany({
    where: { userId, tier, cycle },
    select: { wordId: true },
  });
  const assigned = new Set(assignedThisCycle.map((row) => row.wordId));
  let candidates = activeWords.filter((word) => !assigned.has(word.id));

  if (candidates.length === 0) {
    // Every word in this tier has been used at this cycle: start a new pass.
    cycle += 1;
    candidates = activeWords;
  }

  const wonSessions = await prisma.gameSession.findMany({
    where: { userId, tier, status: "WON" },
    select: { wordId: true },
  });
  const wonWordIds = new Set(wonSessions.map((row) => row.wordId));

  const chosen = chooseWord(candidates, wonWordIds);
  if (chosen === null) {
    throw new NoWordsAvailableError(tier);
  }

  try {
    const created = await prisma.gameSession.create({
      data: { userId, wordId: chosen.id, tier, cycle },
      include: SESSION_INCLUDE,
    });
    return toSessionDto(created);
  } catch (error: unknown) {
    // Two starts raced and the partial unique index rejected this one. The
    // other request's session is the answer, so return it rather than failing.
    const raced = await getActiveSessionDto(userId);
    if (raced !== null) {
      return raced;
    }
    throw error;
  }
}

/** Attempts in a trailing window, used for the throttle and the automation flag. */
export async function countRecentAttempts(sessionId: string, windowMs: number): Promise<number> {
  return prisma.attempt.count({
    where: { sessionId, createdAt: { gt: new Date(Date.now() - windowMs) } },
  });
}

export async function surrenderSession(userId: string, sessionId: string): Promise<SessionDto | null> {
  const session = await prisma.gameSession.findFirst({
    where: { id: sessionId, userId },
    select: { id: true, status: true },
  });
  if (session === null || session.status !== "IN_PROGRESS") {
    return null;
  }

  const updated = await prisma.gameSession.update({
    where: { id: sessionId },
    data: { status: "ABANDONED", endedAt: new Date() },
    include: SESSION_INCLUDE,
  });
  return toSessionDto(updated);
}

export const LIMITS = {
  /** Trailing window for the throttle. */
  throttleWindowMs: 60_000,
  /** More than this many attempts in a minute and the player is politely stalled. */
  throttleAttemptsPerMinute: 10,
  /** Trailing window for the automation flag. */
  flagWindowMs: 5 * 60_000,
  /** More than this many attempts in five minutes and the session is marked as likely automated. */
  flagAttemptsPerFiveMinutes: 20,
} as const;
