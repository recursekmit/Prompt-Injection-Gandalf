import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The parts of user management that can be wrong without a database: the
 * summary arithmetic, the generated-password shape, and the "no hash in the
 * payload" property that keeps a future `findMany` from leaking the column.
 *
 * The writes cannot be reached without a database, so the last block stands one
 * in: `prisma` and `hashPassword` are stubbed and the real `createUser` /
 * `deleteUser` / `abandonLiveSession` run against them. What that reaches is the
 * code in this module — the field-by-field row it builds, the order of the three
 * deletes, and the refusal that must happen before any of them.
 */

const mocks = vi.hoisted(() => ({
  prisma: {
    user: {
      create: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
    gameSession: { findMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    attempt: { groupBy: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  },
  hashPassword: vi.fn<(password: string) => Promise<string>>(),
}));

vi.mock("@/lib/env", () => ({
  env: { adminEmails: ["admin@example.com", "smoke@example.com"] },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/auth/password", () => ({ hashPassword: mocks.hashPassword }));

import {
  AdminUsersError,
  abandonLiveSession,
  createUser,
  deleteUser,
  generatePassword,
  isAdminEmail,
  summariseUsers,
} from "@/lib/admin/users";

const ADA = { id: "u-a", email: "ada@example.com", createdAt: new Date("2026-09-01T00:00:00Z") };
const BOB = { id: "u-b", email: "bob@example.com", createdAt: new Date("2026-09-02T00:00:00Z") };

describe("generatePassword", () => {
  it("is 12 characters of URL-safe alphabet", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(generatePassword()).toMatch(/^[A-Za-z0-9_-]{12}$/);
    }
  });

  it("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generatePassword()));
    expect(seen.size).toBe(50);
  });
});

describe("isAdminEmail", () => {
  it("matches the allowlist regardless of case and surrounding space", () => {
    expect(isAdminEmail("admin@example.com")).toBe(true);
    expect(isAdminEmail("  ADMIN@Example.COM  ")).toBe(true);
  });

  it("does not match a player, or an address that is a prefix of an admin's", () => {
    expect(isAdminEmail("player@example.com")).toBe(false);
    expect(isAdminEmail("admin@example.co")).toBe(false);
  });
});

describe("summariseUsers", () => {
  function summary(
    sessions: ReadonlyArray<{
      id: string;
      userId: string;
      level: number;
      status: string;
    }>,
    attempts: Record<string, number> = {},
    lastAttempts: Record<string, Date> = {},
  ) {
    return summariseUsers({
      players: [ADA, BOB],
      sessions,
      attemptsBySession: new Map(Object.entries(attempts)),
      lastAttemptBySession: new Map(Object.entries(lastAttempts)),
    });
  }

  it("derives the current level from the levels won", () => {
    const rows = summary([
      { id: "s1", userId: "u-a", level: 1, status: "WON" },
      { id: "s2", userId: "u-a", level: 2, status: "WON" },
    ]);

    expect(rows[0]?.levelsCompleted).toBe(2);
    expect(rows[0]?.currentLevel).toBe(3);
  });

  it("leaves a player who has never played on level 1 with no activity", () => {
    const rows = summary([]);

    expect(rows[0]).toMatchObject({ currentLevel: 1, levelsCompleted: 0, totalAttempts: 0 });
    expect(rows[0]?.lastActivityAt).toBeNull();
  });

  it("clamps a player who has won everything to level 6, not 7", () => {
    const rows = summary(
      [1, 2, 3, 4, 5, 6].map((level) => ({
        id: `s${level}`,
        userId: "u-a",
        level,
        status: "WON",
      })),
    );

    expect(rows[0]?.levelsCompleted).toBe(6);
    expect(rows[0]?.currentLevel).toBe(6);
  });

  it("counts attempts from abandoned sessions too", () => {
    const rows = summary(
      [
        { id: "s1", userId: "u-a", level: 1, status: "WON" },
        { id: "s2", userId: "u-a", level: 2, status: "ABANDONED" },
      ],
      { s1: 3, s2: 7 },
    );

    expect(rows[0]?.totalAttempts).toBe(10);
  });

  it("reports the latest attempt, not the first or the last session seen", () => {
    const rows = summary(
      [
        { id: "s1", userId: "u-a", level: 1, status: "WON" },
        { id: "s2", userId: "u-a", level: 2, status: "ABANDONED" },
      ],
      {},
      {
        s1: new Date("2026-09-25T09:00:00Z"),
        s2: new Date("2026-09-25T12:00:00Z"),
      },
    );

    expect(rows[0]?.lastActivityAt).toBe("2026-09-25T12:00:00.000Z");
  });

  it("orders by email, so paging and the cursor agree", () => {
    const rows = summary([]);

    expect(rows.map((row) => row.email)).toEqual(["ada@example.com", "bob@example.com"]);
  });

  it("carries no password hash, whatever the caller passed in", () => {
    const rows = summary([{ id: "s1", userId: "u-a", level: 1, status: "WON" }]);

    // The shape that reaches the browser is built field by field here; this is
    // the assertion that stops a future caller from spreading a Prisma row into
    // it and shipping `passwordHash` to the client.
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        "createdAt",
        "currentLevel",
        "email",
        "id",
        "lastActivityAt",
        "levelsCompleted",
        "totalAttempts",
      ]);
    }
  });
});

describe("createUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hashPassword.mockImplementation(async (password: string) => `hashed:${password}`);
  });

  it("stores the hash, never the plaintext, and returns the plaintext once", async () => {
    mocks.prisma.user.create.mockImplementation(
      async (args: { data: { email: string; passwordHash: string } }) => ({
        id: "u-new",
        email: args.data.email,
        createdAt: new Date("2026-09-25T10:00:00Z"),
      }),
    );

    const created = await createUser({ email: "New@Example.COM" });

    const args = mocks.prisma.user.create.mock.calls[0]?.[0] as {
      data: { email: string; passwordHash: string };
    };
    expect(args.data.email).toBe("new@example.com");
    expect(args.data.passwordHash).toBe(`hashed:${created.password}`);
    expect(args.data.passwordHash).not.toBe(created.password);
  });

  it("returns a row with no hash field, even if the row it read had one", async () => {
    mocks.prisma.user.create.mockResolvedValue({
      id: "u-new",
      email: "new@example.com",
      createdAt: new Date("2026-09-25T10:00:00Z"),
      passwordHash: "$2b$12$should.not.travel",
    });

    const created = await createUser({ email: "new@example.com" });

    expect(Object.keys(created.user).sort()).toEqual([
      "createdAt",
      "currentLevel",
      "email",
      "id",
      "lastActivityAt",
      "levelsCompleted",
      "totalAttempts",
    ]);
    expect(JSON.stringify(created)).not.toContain("should.not.travel");
  });

  it("starts a brand-new player on level 1 with nothing behind them", async () => {
    mocks.prisma.user.create.mockResolvedValue({
      id: "u-new",
      email: "new@example.com",
      createdAt: new Date("2026-09-25T10:00:00Z"),
    });

    const created = await createUser({ email: "new@example.com" });

    expect(created.user).toMatchObject({
      currentLevel: 1,
      levelsCompleted: 0,
      totalAttempts: 0,
      lastActivityAt: null,
    });
  });

  it("uses the supplied password rather than generating one", async () => {
    mocks.prisma.user.create.mockResolvedValue({
      id: "u-new",
      email: "new@example.com",
      createdAt: new Date("2026-09-25T10:00:00Z"),
    });

    const created = await createUser({ email: "new@example.com", password: "chosen-one" });

    expect(created.password).toBe("chosen-one");
  });

  it("turns a duplicate email into a 409 and creates nothing else", async () => {
    mocks.prisma.user.create.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    await expect(createUser({ email: "player@example.com" })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("rejects an unusable address before hashing it", async () => {
    await expect(createUser({ email: "not an address" })).rejects.toBeInstanceOf(AdminUsersError);
    expect(mocks.hashPassword).not.toHaveBeenCalled();
    expect(mocks.prisma.user.create).not.toHaveBeenCalled();
  });
});

describe("deleteUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * The refusal that protects the console from itself. It has to happen before
   * the transaction: a check inside it would delete the attempts and sessions of
   * an admin's account and then fail on the third statement.
   */
  it("refuses an allowlisted account with 409 without touching the database", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ email: "admin@example.com" });

    await expect(deleteUser("u-admin")).rejects.toMatchObject({ status: 409 });

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.prisma.attempt.deleteMany).not.toHaveBeenCalled();
    expect(mocks.prisma.gameSession.deleteMany).not.toHaveBeenCalled();
  });

  it("recognises an admin whatever case the address was stored in", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ email: "ADMIN@example.com" });

    await expect(deleteUser("u-admin")).rejects.toMatchObject({ status: 409 });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("404s an account that does not exist", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(null);

    await expect(deleteUser("u-gone")).rejects.toMatchObject({ status: 404 });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("deletes attempts, then sessions, then the user, and reports the counts", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ email: "player@example.com" });
    mocks.prisma.attempt.deleteMany.mockResolvedValue({ count: 41 });
    mocks.prisma.gameSession.deleteMany.mockResolvedValue({ count: 3 });
    mocks.prisma.user.delete.mockResolvedValue({ id: "u9" });
    mocks.prisma.$transaction.mockImplementation(
      async (fn: (tx: typeof mocks.prisma) => Promise<unknown>) => fn(mocks.prisma),
    );

    const deleted = await deleteUser("u9");

    expect(deleted).toEqual({
      email: "player@example.com",
      sessionsDeleted: 3,
      attemptsDeleted: 41,
    });

    // Order matters: attempts reference sessions, sessions reference the user.
    const order = [
      mocks.prisma.attempt.deleteMany.mock.invocationCallOrder[0],
      mocks.prisma.gameSession.deleteMany.mock.invocationCallOrder[0],
      mocks.prisma.user.delete.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });
});

describe("abandonLiveSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("abandons the live session and names the player", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ email: "player@example.com" });
    mocks.prisma.gameSession.updateMany.mockResolvedValue({ count: 1 });

    await expect(abandonLiveSession("u9")).resolves.toEqual({ email: "player@example.com" });
    expect(mocks.prisma.gameSession.updateMany).toHaveBeenCalledWith({
      where: { userId: "u9", status: "IN_PROGRESS" },
      data: { status: "ABANDONED", endedAt: expect.any(Date) },
    });
  });

  it("409s a player who has nothing in progress, rather than reporting success", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ email: "player@example.com" });
    mocks.prisma.gameSession.updateMany.mockResolvedValue({ count: 0 });

    await expect(abandonLiveSession("u9")).rejects.toMatchObject({ status: 409 });
  });

  it("404s an account that does not exist", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(null);

    await expect(abandonLiveSession("u-gone")).rejects.toMatchObject({ status: 404 });
    expect(mocks.prisma.gameSession.updateMany).not.toHaveBeenCalled();
  });
});
