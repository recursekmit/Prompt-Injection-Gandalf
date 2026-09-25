import { randomBytes } from "node:crypto";

import { hashPassword } from "@/lib/auth/password";
import { env } from "@/lib/env";
import { MAX_LEVEL } from "@/lib/guardian/levels";
import { prisma } from "@/lib/prisma";
import { readCredentials } from "@/lib/validation";
import type { AdminUserRow, AdminUsersResponse } from "@/lib/types";

/**
 * Admin user management: who exists, and the four things an operator standing at
 * the door needs to do to them.
 *
 * Two rules govern this file.
 *
 * 1. A password exists in plaintext exactly once — in the response to the call
 *    that generated it. It is never stored (only a bcrypt hash is), never
 *    logged, and never echoed by a later read. `summariseUsers` is the only
 *    thing that shapes a user for output, and it has no password field to
 *    forget about.
 * 2. Nothing here can delete an admin. The allowlist in `ADMIN_EMAILS` is the
 *    authority, and a console that can delete the account it is signed in as is
 *    a console that can lock the event out of itself.
 */

/** 9 bytes of base64url is exactly 12 characters, and always 12. */
const GENERATED_PASSWORD_BYTES = 9;

export function generatePassword(): string {
  return randomBytes(GENERATED_PASSWORD_BYTES).toString("base64url");
}

export class AdminUsersError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AdminUsersError";
  }
}

/**
 * Prisma raises P2002 when a unique constraint is violated. Duck-typed for the
 * same reason the signup route duck-types it: a wrapped or re-created error
 * object must not slip past as a 500.
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export function isAdminEmail(email: string): boolean {
  return env.adminEmails.includes(email.trim().toLowerCase());
}

/* ------------------------------------------------------------------ reads -- */

export interface UserSummaryInput {
  readonly players: readonly { id: string; email: string; createdAt: Date }[];
  readonly sessions: readonly {
    readonly id: string;
    readonly userId: string;
    readonly level: number;
    readonly status: string;
  }[];
  readonly attemptsBySession: ReadonlyMap<string, number>;
  readonly lastAttemptBySession: ReadonlyMap<string, Date>;
}

/**
 * Pure, so the "who needs help" arithmetic can be tested without a database.
 *
 * `currentLevel` is derived as one past the levels won, which is correct because
 * levels are gated strictly in order — a player cannot win level 4 without
 * having won 1 to 3. It is clamped so an all-levels winner reads as level 6
 * rather than 7, which is a level that does not exist.
 */
export function summariseUsers(input: UserSummaryInput): AdminUserRow[] {
  const byPlayer = new Map<
    string,
    { levelsWon: Set<number>; attempts: number; lastAttempt: Date | null }
  >();

  for (const player of input.players) {
    byPlayer.set(player.id, { levelsWon: new Set<number>(), attempts: 0, lastAttempt: null });
  }

  for (const session of input.sessions) {
    const record = byPlayer.get(session.userId);
    if (record === undefined) {
      continue;
    }

    record.attempts += input.attemptsBySession.get(session.id) ?? 0;
    if (session.status === "WON") {
      record.levelsWon.add(session.level);
    }

    const lastAttempt = input.lastAttemptBySession.get(session.id);
    if (lastAttempt !== undefined && (record.lastAttempt === null || lastAttempt > record.lastAttempt)) {
      record.lastAttempt = lastAttempt;
    }
  }

  return input.players
    .map((player) => {
      const record = byPlayer.get(player.id);
      const levelsCompleted = record?.levelsWon.size ?? 0;
      return {
        id: player.id,
        email: player.email,
        createdAt: player.createdAt.toISOString(),
        levelsCompleted,
        currentLevel: Math.min(levelsCompleted + 1, MAX_LEVEL),
        totalAttempts: record?.attempts ?? 0,
        lastActivityAt:
          record?.lastAttempt === null || record?.lastAttempt === undefined
            ? null
            : record.lastAttempt.toISOString(),
      };
    })
    .sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0));
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(raw: string | null): number {
  if (raw === null) {
    return DEFAULT_LIMIT;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAX_LIMIT);
}

/**
 * Three queries plus a user page, whatever the search: the same shape the
 * leaderboard uses, and for the same reason. An admin screen that fires a query
 * per row is slow exactly when the event is busiest.
 */
export async function listUsers(query: {
  q?: string | null;
  limit?: string | null;
  cursor?: string | null;
}): Promise<AdminUsersResponse> {
  const search = (query.q ?? "").trim().toLowerCase();
  const limit = clampLimit(query.limit ?? null);

  const players = await prisma.user.findMany({
    where: search === "" ? {} : { email: { contains: search, mode: "insensitive" } },
    select: { id: true, email: true, createdAt: true },
    orderBy: { email: "asc" },
    take: limit,
    // Cursor paging on the value the rows are ordered by, so a page boundary
    // cannot skip or repeat a row the way an offset would if a user is created
    // between two requests.
    ...(query.cursor != null && query.cursor !== ""
      ? { cursor: { email: query.cursor }, skip: 1 }
      : {}),
  });

  const ids = players.map((player) => player.id);

  const [sessions, attemptGroups, lastAttempts] = await Promise.all([
    prisma.gameSession.findMany({
      where: { userId: { in: ids } },
      select: { id: true, userId: true, level: true, status: true },
    }),
    prisma.attempt.groupBy({
      by: ["sessionId"],
      _count: { _all: true },
      where: { session: { userId: { in: ids } } },
    }),
    prisma.attempt.groupBy({
      by: ["sessionId"],
      _max: { createdAt: true },
      where: { session: { userId: { in: ids } } },
    }),
  ]);

  const attemptsBySession = new Map(attemptGroups.map((g) => [g.sessionId, g._count._all]));
  const lastAttemptBySession = new Map<string, Date>();
  for (const group of lastAttempts) {
    if (group._max.createdAt !== null) {
      lastAttemptBySession.set(group.sessionId, group._max.createdAt);
    }
  }

  const rows = summariseUsers({ players, sessions, attemptsBySession, lastAttemptBySession });
  const last = players.at(-1);

  return {
    users: rows,
    nextCursor: players.length === limit && last !== undefined ? last.email : null,
  };
}

/** Every account, unpaginated, for the counts the page's header shows. */
export async function countUsers(): Promise<number> {
  return prisma.user.count();
}

/* ----------------------------------------------------------------- writes -- */

export interface CreatedUser {
  readonly user: AdminUserRow;
  /** Returned once, never stored, never readable again. */
  readonly password: string;
}

export async function createUser(input: {
  email?: unknown;
  password?: unknown;
}): Promise<CreatedUser> {
  const generated = input.password === undefined || input.password === null || input.password === "";
  const password = generated ? generatePassword() : String(input.password);

  const parsed = readCredentials({ email: input.email, password });
  if (!parsed.ok) {
    // The parse errors are written for a player filling in a form, and they fit
    // an operator too — "Enter a valid email address" is the whole problem.
    throw new AdminUsersError(parsed.error, 400);
  }

  try {
    const user = await prisma.user.create({
      data: { email: parsed.email, passwordHash: await hashPassword(parsed.password) },
      select: { id: true, email: true, createdAt: true },
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt.toISOString(),
        levelsCompleted: 0,
        currentLevel: 1,
        totalAttempts: 0,
        lastActivityAt: null,
      },
      password: parsed.password,
    };
  } catch (error) {
    // Check-then-insert would race two operators creating the same player at
    // once; let the unique constraint decide and translate the answer.
    if (isUniqueConstraintViolation(error)) {
      throw new AdminUsersError("That email address already has an account.", 409);
    }
    throw error;
  }
}

export async function resetUserPassword(
  userId: string,
  input: { password?: unknown },
): Promise<{ readonly email: string; readonly password: string }> {
  const password =
    input.password === undefined || input.password === null || input.password === ""
      ? generatePassword()
      : String(input.password);

  const existing = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (existing === null) {
    throw new AdminUsersError("No such user.", 404);
  }

  // Validated against the address already on the account rather than the one in
  // the request: this route resets a password and must never move a user to a
  // different email by accident.
  const parsed = readCredentials({ email: existing.email, password });
  if (!parsed.ok) {
    throw new AdminUsersError(parsed.error, 400);
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(parsed.password) },
  });

  return { email: existing.email, password: parsed.password };
}

export interface DeletedUser {
  readonly email: string;
  readonly sessionsDeleted: number;
  readonly attemptsDeleted: number;
}

/**
 * Deletes a user, their sessions and their attempts, reporting what went.
 *
 * The three deletes are one transaction: attempts reference sessions, sessions
 * reference the user, and a partial delete would leave rows pointing at a user
 * that no longer exists.
 *
 * The attempt and win history is destroyed by this. The caller reports the
 * counts back so the operator sees the difference between a mistyped address
 * created a minute ago and an account with forty attempts behind it.
 */
export async function deleteUser(userId: string): Promise<DeletedUser> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (user === null) {
    throw new AdminUsersError("No such user.", 404);
  }

  if (isAdminEmail(user.email)) {
    throw new AdminUsersError(
      "That account is an admin. Admins are listed in ADMIN_EMAILS, so deleting one here would lock the console out of itself.",
      409,
    );
  }

  return prisma.$transaction(async (tx) => {
    const attempts = await tx.attempt.deleteMany({ where: { session: { userId } } });
    const sessions = await tx.gameSession.deleteMany({ where: { userId } });
    await tx.user.delete({ where: { id: userId } });

    return {
      email: user.email,
      sessionsDeleted: sessions.count,
      attemptsDeleted: attempts.count,
    };
  });
}

/** Abandons a player's live session, so their next visit starts the level fresh. */
export async function abandonLiveSession(userId: string): Promise<{ readonly email: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (user === null) {
    throw new AdminUsersError("No such user.", 404);
  }

  const updated = await prisma.gameSession.updateMany({
    where: { userId, status: "IN_PROGRESS" },
    data: { status: "ABANDONED", endedAt: new Date() },
  });

  if (updated.count === 0) {
    throw new AdminUsersError("That player has no session in progress.", 409);
  }

  return { email: user.email };
}
