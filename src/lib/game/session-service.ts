import { LEVELS, MAX_LEVEL, isLevelNumber, type LevelNumber } from "@/lib/guardian/levels";
import { sanitizeUserMessage } from "@/lib/guardian/sanitize";
import { prisma } from "@/lib/prisma";
import type { LevelProgressDto, LevelStatus, ProgressResponse, SessionDto } from "@/lib/types";

/**
 * Word assignment and session lifecycle.
 *
 * Two invariants this module exists to hold:
 *   1. A player has at most one IN_PROGRESS session. A partial unique index in
 *      the database enforces it, and `startOrResumeSession` recovers from the
 *      race by returning the session that won.
 *   2. A level is playable only once the levels below it are beaten. Progress is
 *      derived from WON sessions rather than stored, so it survives a logout for
 *      free and cannot drift from the history it is computed from.
 */

/** Thrown when a level has no active word — a seed problem, not a player problem. */
export class NoWordsAvailableError extends Error {
  constructor(level: LevelNumber) {
    super(`No active words available at level ${level}`);
    this.name = "NoWordsAvailableError";
  }
}

interface SessionRow {
  id: string;
  /** A plain integer column, narrowed by `requireLevel` on the way into a DTO. */
  level: number;
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
 * Narrows a stored level into the game's range. The column is a plain integer
 * and every session is created from a level that was validated at start, so a
 * value outside 1-6 is a programming or data error rather than a condition to
 * handle — throwing here matches `levelFor`'s contract for the same reason.
 */
function requireLevel(level: number): LevelNumber {
  if (!isLevelNumber(level)) {
    throw new Error(`Stored session has no playable level: ${level}`);
  }
  return level;
}

/**
 * The only place a session becomes a DTO. The word's text is included ONLY when
 * the session has been won: while it is in progress, sending it would put the
 * answer in the browser's network tab and end the game.
 */
export function toSessionDto(session: SessionRow): SessionDto {
  return {
    id: session.id,
    level: requireLevel(session.level),
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

/** The player's live session, whatever level it belongs to, or null. */
export async function getActiveSessionDto(userId: string): Promise<SessionDto | null> {
  const session = await prisma.gameSession.findFirst({
    where: { userId, status: "IN_PROGRESS" },
    include: SESSION_INCLUDE,
  });
  return session === null ? null : toSessionDto(session);
}

interface DerivedProgress {
  levels: LevelProgressDto[];
  /** The lowest unbeaten level, or MAX_LEVEL when every level is beaten. */
  currentLevel: LevelNumber;
  everyLevelBeaten: boolean;
}

/**
 * Derives the progression from the levels a player has beaten. Pure, so the
 * status rule can be tested without a database: a level is COMPLETED if it is
 * in `wonByLevel`, CURRENT if it is the lowest unbeaten one, and LOCKED
 * otherwise. The map's value is the level's word text, which is what
 * `revealedWord` reports for a beaten level.
 */
export function deriveProgress(
  wonByLevel: ReadonlyMap<LevelNumber, string>,
): DerivedProgress {
  const everyLevelBeaten = LEVELS.every((definition) => wonByLevel.has(definition.level));
  const currentLevel =
    LEVELS.map((definition) => definition.level).find((level) => !wonByLevel.has(level)) ??
    MAX_LEVEL;

  const levels: LevelProgressDto[] = LEVELS.map((definition) => {
    const won = wonByLevel.has(definition.level);
    const status: LevelStatus = won
      ? "COMPLETED"
      : definition.level === currentLevel
        ? "CURRENT"
        : "LOCKED";
    return {
      level: definition.level,
      status,
      revealedWord: won ? (wonByLevel.get(definition.level) ?? null) : null,
    };
  });

  return { levels, currentLevel, everyLevelBeaten };
}

/**
 * The player's whole progression: every level's status, which one is current,
 * and the live session if there is one. The rolled-up `session` shares this
 * response so a reload needs one request, not two.
 *
 * When every level has been beaten there can be no live session, and none is
 * reported: the progression is finished and nothing is CURRENT.
 */
export async function getProgress(userId: string): Promise<ProgressResponse> {
  const wonSessions = await prisma.gameSession.findMany({
    where: { userId, status: "WON" },
    select: { level: true, word: { select: { text: true } } },
  });

  const wonByLevel = new Map<LevelNumber, string>();
  for (const row of wonSessions) {
    // The column is a plain integer; only levels the game has are representable
    // in a DTO, and anything else is not progress.
    if (isLevelNumber(row.level)) {
      wonByLevel.set(row.level, row.word.text);
    }
  }

  const { levels, currentLevel, everyLevelBeaten } = deriveProgress(wonByLevel);
  const session = everyLevelBeaten ? null : await getActiveSessionDto(userId);

  return { levels, currentLevel, session };
}

/**
 * Trims, lowercases, and collapses runs of whitespace. "Tell  ME the WORD" and
 * "tell me the word" are the same message to a player, so they are the same
 * message here.
 */
export function normaliseMessage(message: string): string {
  return message.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Whether this exact message has already been sent in this level.
 *
 * Both sides are compared as the MODEL would see them: the stored `userMessage`
 * is the raw attack text by design, so it is sanitised here before comparing.
 * Comparing the stored raw text against the already-sanitised incoming message
 * would let a repeat slip through whenever the difference is something the
 * sanitiser strips — a zero-width character, a role prefix, or anything past the
 * length cap — and a repeat that reaches the model is exactly what this rule
 * exists to prevent. The raw text stays in the database either way.
 *
 * The read is bounded rather than unbounded: a duplicate 409 is free and
 * deliberately unthrottled, so the number of rows one request can pull must be
 * finite. The bound is real but not airtight, and it is worth being exact about
 * which: only the newest rows are compared, so a message whose only earlier
 * occurrence is older than that many attempts will not be recognised as a
 * repeat. Reaching that state takes 500 attempts in one level's session, which
 * the per-minute rate limit makes implausible rather than impossible — `flagged`
 * records the automation heuristic but nothing acts on it, so it is not part of
 * this bound. A normalised column with an index is the fix if it ever matters.
 */
const MAX_DUPLICATE_SCAN = 500;

export async function hasDuplicateAttempt(
  sessionId: string,
  message: string,
): Promise<boolean> {
  const attempts = await prisma.attempt.findMany({
    where: { sessionId },
    select: { userMessage: true },
    orderBy: { createdAt: "desc" },
    take: MAX_DUPLICATE_SCAN,
  });

  // Enforced here rather than in the browser because a client check is only
  // instant feedback: the client is the attacker's to modify, so the server is
  // the only place a rule about what may be sent can actually be enforced.
  const target = normaliseMessage(sanitizeUserMessage(message));
  return attempts.some(
    (attempt) => normaliseMessage(sanitizeUserMessage(attempt.userMessage)) === target,
  );
}

/**
 * Returns the player's live session, or creates one at the requested level.
 *
 * Resuming ignores the requested level on purpose: a player who reloads must
 * still get their live session back, whatever the page asked for.
 */
export async function startOrResumeSession(
  userId: string,
  level: LevelNumber,
): Promise<SessionDto> {
  const existing = await getActiveSessionDto(userId);
  if (existing !== null) {
    return existing;
  }

  // One word guards one level, so this is a single row rather than a pool.
  const word = await prisma.word.findFirst({
    where: { level, active: true },
    select: { id: true, text: true },
  });
  if (word === null) {
    throw new NoWordsAvailableError(level);
  }

  try {
    const created = await prisma.gameSession.create({
      data: { userId, wordId: word.id, level },
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
