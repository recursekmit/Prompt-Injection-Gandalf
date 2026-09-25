import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Exhaustion proof at the four-key scale.
 *
 * The spec calls out the "all keys exhausted -> queue -> graceful failure" path
 * as the one that is far easier to hit with a handful of testers than at the
 * ~15-key production scale, so it is pinned here against exactly 4 keys.
 *
 * Every test below drives the clock with fake timers and a stateful Prisma
 * double: no network, no Groq quota, no real sleeping. The double is the same
 * contract as `groq-key-pool.test.ts` (one metrics query, one insert, one
 * delete, two upserts) with one addition: a `transactions` counter, which is
 * the pool's poll counter as well, since every queue iteration reserves through
 * exactly one `$transaction`.
 */
const fake = vi.hoisted(() => {
  interface LogRow {
    keyIndex: number;
    createdAt: Date;
  }
  interface DailyRow {
    keyIndex: number;
    date: Date;
    count: number;
  }
  interface CooldownRow {
    keyIndex: number;
    exhaustedUntil: Date;
  }

  const state = {
    logs: [] as LogRow[],
    daily: [] as DailyRow[],
    cooldowns: [] as CooldownRow[],
    prunes: 0,
    /** Number of `$transaction` calls: one per pool poll, plus describePool. */
    transactions: 0,
  };

  const env = {
    groqApiKeys: ["k0", "k1", "k2", "k3"] as string[],
    groqKeyRpd: 1000,
    groqKeyRpm: 30,
    queueMaxWaitMs: 12_000,
    queuePollMs: 300,
  };

  const reset = (): void => {
    state.logs = [];
    state.daily = [];
    state.cooldowns = [];
    state.prunes = 0;
    state.transactions = 0;
    env.groqApiKeys = ["k0", "k1", "k2", "k3"];
    env.groqKeyRpd = 1000;
    env.groqKeyRpm = 30;
    env.queueMaxWaitMs = 12_000;
    env.queuePollMs = 300;
  };

  const client = {
    $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      // Positional, exactly as the real query is built: the window start comes
      // first, today's UTC date is the final parameter.
      const since = values[0] as Date;
      const today = values[values.length - 1] as Date;
      const indices = new Set<number>();
      for (const log of state.logs) indices.add(log.keyIndex);
      for (const row of state.daily) indices.add(row.keyIndex);
      for (const row of state.cooldowns) indices.add(row.keyIndex);
      return [...indices].sort((a, b) => a - b).map((keyIndex) => {
        const windowed = state.logs.filter(
          (log) => log.keyIndex === keyIndex && log.createdAt.getTime() > since.getTime(),
        );
        const daily = state.daily.find(
          (row) => row.keyIndex === keyIndex && row.date.getTime() === today.getTime(),
        );
        const cooldown = state.cooldowns.find((row) => row.keyIndex === keyIndex);
        return {
          keyIndex,
          rollingCount: windowed.length,
          lastRequestAt:
            windowed.length > 0
              ? new Date(Math.max(...windowed.map((log) => log.createdAt.getTime())))
              : null,
          dailyCount: daily?.count ?? 0,
          exhaustedUntil: cooldown?.exhaustedUntil ?? null,
        };
      });
    },
    apiKeyRequestLog: {
      create: async (args: { data: { keyIndex: number } }) => {
        const createdAt = new Date();
        state.logs.push({ keyIndex: args.data.keyIndex, createdAt });
        return { id: `log-${state.logs.length}`, keyIndex: args.data.keyIndex, createdAt };
      },
      deleteMany: async (args: { where: { createdAt: { lt: Date } } }) => {
        const before = state.logs.length;
        state.logs = state.logs.filter(
          (log) => log.createdAt.getTime() >= args.where.createdAt.lt.getTime(),
        );
        state.prunes += 1;
        return { count: before - state.logs.length };
      },
    },
    apiKeyDailyUsage: {
      upsert: async (args: {
        where: { keyIndex_date: { keyIndex: number; date: Date } };
        create: { keyIndex: number; date: Date; count: number };
        update: { count: { increment: number } };
      }) => {
        const { keyIndex, date } = args.where.keyIndex_date;
        const existing = state.daily.find(
          (row) => row.keyIndex === keyIndex && row.date.getTime() === date.getTime(),
        );
        if (existing !== undefined) {
          existing.count += args.update.count.increment;
        } else {
          state.daily.push({ keyIndex, date, count: args.create.count });
        }
        return { keyIndex, date, count: existing?.count ?? args.create.count };
      },
    },
    apiKeyCooldown: {
      upsert: async (args: {
        where: { keyIndex: number };
        create: CooldownRow;
        update: { exhaustedUntil: Date };
      }) => {
        const existing = state.cooldowns.find((row) => row.keyIndex === args.where.keyIndex);
        if (existing !== undefined) {
          existing.exhaustedUntil = args.update.exhaustedUntil;
          return existing;
        }
        state.cooldowns.push({ ...args.create });
        return { ...args.create };
      },
    },
  };

  const prisma = {
    ...client,
    $transaction: async <T>(fn: (tx: typeof client) => Promise<T>): Promise<T> => {
      state.transactions += 1;
      return fn(client);
    },
  };

  return { state, env, prisma, reset };
});

vi.mock("@/lib/env", () => ({ env: fake.env }));
vi.mock("@/lib/prisma", () => ({ prisma: fake.prisma }));

import { GuardianBusyError, describePool, withGroqKey } from "@/lib/groq-key-pool";

const START = new Date("2026-09-25T12:00:00.000Z");

/** The `@db.Date` day bucket the pool uses for the daily counter. */
function todayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function rateLimitError(retryAfterSeconds: number | null): Error {
  const headers = new Headers();
  if (retryAfterSeconds !== null) {
    headers.set("retry-after", String(retryAfterSeconds));
  }
  return Object.assign(new Error("429 rate limited"), { status: 429, headers });
}

/** Fires a call and reports whether it settled, without awaiting it. */
function track<T>(promise: Promise<T>): { settled: () => boolean; rejection: () => unknown } {
  let done = false;
  let rejected: unknown = null;
  void promise.then(
    () => {
      done = true;
    },
    (error: unknown) => {
      done = true;
      rejected = error;
    },
  );
  return { settled: () => done, rejection: () => rejected };
}

/** Saturates `keyIndex` by filling its sliding-minute window to the RPM cap. */
function saturateMinute(keyIndex: number, createdAt: Date): void {
  for (let i = 0; i < fake.env.groqKeyRpm; i += 1) {
    fake.state.logs.push({ keyIndex, createdAt });
  }
}

/** Saturates every key in the pool at the same instant. */
function saturatePool(createdAt: Date): void {
  for (const keyIndex of [0, 1, 2, 3]) {
    saturateMinute(keyIndex, createdAt);
  }
}

describe("withGroqKey exhaustion at four keys", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    fake.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("queues when all four keys are at the minute limit, and throws only at the deadline", async () => {
    // Pin the poll jitter to zero so the retry cadence is exactly one poll per
    // queuePollMs and the poll count below is a fixed number, not a range.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    saturatePool(START);

    const pending = withGroqKey(async () => "never");
    const { settled, rejection } = track(pending);
    // The first poll runs synchronously when the call starts: one reservation
    // attempt, and it found nothing.
    expect(fake.state.transactions).toBe(1);

    // 11s of 300ms polls: 300..10800 inclusive = 36 more attempts.
    await vi.advanceTimersByTimeAsync(11_000);
    expect(settled()).toBe(false);
    expect(rejection()).toBeNull();
    expect(fake.state.transactions).toBe(37);

    // The 40th sleep lands on the deadline, so the 41st poll throws.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(rejection()).toBeInstanceOf(GuardianBusyError);
    expect(fake.state.transactions).toBe(41);
    expect(settled()).toBe(true);

    // Queued, not reserved, for the whole wait: still exactly the seeded rows.
    expect(fake.state.logs).toHaveLength(4 * fake.env.groqKeyRpm);
    expect(fake.env.groqKeyRpm).toBe(30);
  });

  it("serves the queued call when one key's window frees before the deadline", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    // Key 0's 30 requests happened 50s before START, so they leave the 60s
    // window at START + 10s -- inside the 12s queue deadline. Keys 1-3 were
    // used at START and stay saturated past the deadline.
    saturateMinute(0, new Date(START.getTime() - 50_000));
    for (const keyIndex of [1, 2, 3]) {
      saturateMinute(keyIndex, START);
    }

    const pending = withGroqKey(async (_client, keyIndex) => keyIndex);
    const { settled, rejection } = track(pending);

    await vi.advanceTimersByTimeAsync(9_000);
    expect(settled()).toBe(false);
    expect(rejection()).toBeNull();

    await vi.advanceTimersByTimeAsync(2_000);
    // The waiting player gets an answer, not a 503.
    await expect(pending).resolves.toBe(0);
    expect(rejection()).toBeNull();
    // Key 0 was reserved exactly once, at the moment its window reopened.
    expect(fake.state.logs).toHaveLength(4 * fake.env.groqKeyRpm + 1);
    expect(fake.state.transactions).toBeGreaterThan(1);
  });

  it("skips a key whose daily budget is spent even though its minute window is empty", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    fake.env.groqKeyRpd = 1;
    // Key 0 has room in its rolling window (no log rows at all) but its daily
    // counter is already at the cap.
    fake.state.daily.push({ keyIndex: 0, date: todayUtc(START), count: 1 });

    const order: number[] = [];
    const use = async (): Promise<void> => {
      await withGroqKey(async (_client, keyIndex) => {
        order.push(keyIndex);
        return "ok";
      });
    };

    await use();
    await use();
    await use();

    expect(order).toEqual([1, 2, 3]);
    expect(fake.state.logs.some((log) => log.keyIndex === 0)).toBe(false);

    // Every key is now spent for the day, so the next call queues and fails
    // gracefully at the deadline instead of using the daily-exhausted key 0.
    const pending = withGroqKey(async () => "never");
    const { rejection } = track(pending);
    await vi.advanceTimersByTimeAsync(13_000);
    expect(rejection()).toBeInstanceOf(GuardianBusyError);
    expect(fake.state.logs).toHaveLength(3);
  });

  it("retires a 429'd key for the rest of the minute regardless of local counts", async () => {
    // Keys 2 and 3 are held at their minute cap so the pool has exactly keys 0
    // and 1 to choose from; every one of the four keys is therefore in play.
    saturateMinute(2, START);
    saturateMinute(3, START);

    const attempts: number[] = [];
    const result = await withGroqKey(async (_client, keyIndex) => {
      attempts.push(keyIndex);
      if (attempts.length === 1) {
        throw rateLimitError(30);
      }
      return "ok";
    });

    // Key 0 was reserved, Groq rate-limited it, and the same request was
    // retried on the next available key rather than failing.
    expect(result).toBe("ok");
    expect(attempts).toEqual([0, 1]);
    expect(fake.state.cooldowns).toHaveLength(1);
    expect(fake.state.cooldowns[0]?.keyIndex).toBe(0);
    expect(fake.state.cooldowns[0]?.exhaustedUntil.getTime()).toBe(START.getTime() + 30_000);

    // Locally key 0 looks fine -- one request in the window against a cap of 30
    // -- but Groq's 429 outranks the local ledger, so it is not available.
    const pool = await describePool();
    expect(pool.keys[0]).toMatchObject({
      keyIndex: 0,
      rollingCount: 1,
      dailyCount: 1,
      available: false,
    });
    expect(pool.keys[1]?.available).toBe(true);
    expect(pool.keys[2]?.available).toBe(false);
    expect(pool.keys[3]?.available).toBe(false);

    const second: number[] = [];
    await withGroqKey(async (_client, keyIndex) => {
      second.push(keyIndex);
      return "ok";
    });
    // Key 1 is the only candidate left. Were the cooldown ignored, the LRU
    // tie-break (equal last-request time, equal daily count, lowest index)
    // would have sent this call straight back to key 0.
    expect(second).toEqual([1]);
  });

  it("caps the wait, so a saturated pool never blocks much past the deadline", async () => {
    saturatePool(START);

    const pending = withGroqKey(async () => "never");
    let thrownAt = -1;
    void pending.catch(() => {
      if (thrownAt < 0) {
        thrownAt = Date.now();
      }
    });

    // Real jitter here on purpose. The clock is stepped in 100ms ticks, and
    // every sleep is a multiple of 100ms, so the loop stops on the exact tick
    // the queue gave up rather than after the batch advance ran past it.
    for (let tick = 0; tick < 300 && thrownAt < 0; tick += 1) {
      await vi.advanceTimersByTimeAsync(100);
    }

    await expect(pending).rejects.toBeInstanceOf(GuardianBusyError);
    const waited = thrownAt - START.getTime();

    // The deadline is never given up on early...
    expect(waited).toBeGreaterThanOrEqual(fake.env.queueMaxWaitMs);
    // ...and it is never slept past either. Each sleep is clamped to whatever is
    // left of the deadline, so a saturated pool gives up ON the cap rather than
    // up to one poll interval after it. The small allowance is timer-granularity
    // slack, not a second poll.
    expect(waited).toBeLessThanOrEqual(fake.env.queueMaxWaitMs + 100);
    // It really did retry throughout rather than bailing out immediately.
    expect(fake.state.transactions).toBeGreaterThan(30);
  });
});
