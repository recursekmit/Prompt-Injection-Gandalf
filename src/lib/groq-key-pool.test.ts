import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * In-memory stand-in for the Prisma client. The pool's contract with the
 * database is narrow (one metrics query, one insert, one delete, two upserts),
 * so a fake with real state exercises the reservation and queueing logic
 * without a live Postgres. `$queryRaw` is parsed positionally: the pooled
 * metrics query passes the window start first and today's UTC date second.
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
    env.groqApiKeys = ["k0", "k1", "k2", "k3"];
    env.groqKeyRpd = 1000;
    env.groqKeyRpm = 30;
    env.queueMaxWaitMs = 12_000;
    env.queuePollMs = 300;
  };

  const client = {
    $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      // The window start appears once per rolling-count subquery; today's UTC
      // date is always the final parameter. Positional parsing keeps this fake
      // honest about what the pool actually sends.
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
    $transaction: async <T>(fn: (tx: typeof client) => Promise<T>): Promise<T> => fn(client),
  };

  return { state, env, prisma, reset };
});

vi.mock("@/lib/env", () => ({ env: fake.env }));
vi.mock("@/lib/prisma", () => ({ prisma: fake.prisma }));

import { GuardianBusyError, describePool, withGroqKey } from "@/lib/groq-key-pool";

const START = new Date("2026-09-25T12:00:00.000Z");

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

describe("withGroqKey", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    fake.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows the 30th request in a minute and queues the 31st instead of failing", async () => {
    fake.env.groqApiKeys = ["k0"];

    for (let i = 0; i < 30; i += 1) {
      await expect(withGroqKey(async () => "ok")).resolves.toBe("ok");
    }
    expect(fake.state.logs).toHaveLength(30);

    const pending = withGroqKey(async () => "ok");
    const { settled, rejection } = track(pending);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(settled()).toBe(false);
    // Queued, not reserved: no log row was written for the 31st request yet.
    expect(fake.state.logs).toHaveLength(30);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(rejection()).toBeInstanceOf(GuardianBusyError);
  });

  it("counts a sliding window, so a burst straddling the minute boundary still queues", async () => {
    fake.env.groqApiKeys = ["k0"];
    fake.env.queueMaxWaitMs = 120_000;
    vi.setSystemTime(new Date("2026-09-25T12:00:50.000Z"));

    for (let i = 0; i < 30; i += 1) {
      await withGroqKey(async () => "ok");
    }

    // 10 seconds later the wall-clock minute has rolled over. A fixed bucket
    // would have reset to zero and let 30 more requests through here.
    await vi.advanceTimersByTimeAsync(10_000);
    const pending = withGroqKey(async () => "ok");
    const { settled } = track(pending);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(settled()).toBe(false);
    expect(fake.state.logs).toHaveLength(30);

    // Past 60s the whole burst falls out of the window, so the queued call runs.
    await vi.advanceTimersByTimeAsync(51_000);
    await expect(pending).resolves.toBe("ok");
    expect(fake.state.logs).toHaveLength(31);
  });

  it("enforces the per-key daily cap", async () => {
    fake.env.groqApiKeys = ["k0"];
    fake.env.groqKeyRpd = 2;

    await expect(withGroqKey(async () => "first")).resolves.toBe("first");
    await expect(withGroqKey(async () => "second")).resolves.toBe("second");
    expect(fake.state.daily[0]?.count).toBe(2);

    const pending = withGroqKey(async () => "third");
    const { settled, rejection } = track(pending);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(settled()).toBe(false);
    expect(fake.state.logs).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(rejection()).toBeInstanceOf(GuardianBusyError);
  });

  it("cools a 429'd key down and retries the call on the next key", async () => {
    fake.env.groqApiKeys = ["k0", "k1"];
    const attempts: number[] = [];

    const result = await withGroqKey(async (_client, keyIndex) => {
      attempts.push(keyIndex);
      if (attempts.length === 1) {
        throw rateLimitError(30);
      }
      return "ok";
    });

    expect(result).toBe("ok");
    expect(attempts).toEqual([0, 1]);
    expect(fake.state.cooldowns).toHaveLength(1);
    const cooldown = fake.state.cooldowns[0];
    expect(cooldown?.keyIndex).toBe(0);
    expect(cooldown?.exhaustedUntil.getTime()).toBe(START.getTime() + 30_000);
  });

  it("falls back to a ~55s cooldown when the 429 carries no retry-after", async () => {
    fake.env.groqApiKeys = ["k0", "k1"];

    await withGroqKey(async (_client, keyIndex) => {
      if (keyIndex === 0) {
        throw rateLimitError(null);
      }
      return "ok";
    });

    expect(fake.state.cooldowns[0]?.exhaustedUntil.getTime()).toBe(START.getTime() + 55_000);
  });

  it("throws GuardianBusyError at the deadline, not before, when every key is exhausted", async () => {
    fake.env.groqApiKeys = ["k0", "k1"];
    const exhaustedUntil = new Date(START.getTime() + 5 * 60_000);
    fake.state.cooldowns.push({ keyIndex: 0, exhaustedUntil }, { keyIndex: 1, exhaustedUntil });

    const pending = withGroqKey(async () => "never");
    const { settled, rejection } = track(pending);

    await vi.advanceTimersByTimeAsync(11_000);
    expect(settled()).toBe(false);
    expect(rejection()).toBeNull();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(rejection()).toBeInstanceOf(GuardianBusyError);
  });

  it("picks the least recently used key, tie-broken by lowest daily count", async () => {
    fake.env.groqApiKeys = ["k0", "k1", "k2"];
    const order: number[] = [];
    const use = async (): Promise<void> => {
      await withGroqKey(async (_client, keyIndex) => {
        order.push(keyIndex);
        return "ok";
      });
    };

    await use();
    await vi.advanceTimersByTimeAsync(1_000);
    await use();
    await vi.advanceTimersByTimeAsync(1_000);
    await use();
    await vi.advanceTimersByTimeAsync(1_000);
    await use();

    // Third call wraps back to k0: it has the oldest last request, all counts tied.
    expect(order).toEqual([0, 1, 2, 0]);
  });

  it("retries a 5xx with backoff, up to three attempts", async () => {
    fake.env.groqApiKeys = ["k0"];
    let attempts = 0;
    const pending = withGroqKey(async () => {
      attempts += 1;
      throw Object.assign(new Error("500"), { status: 500 });
    });
    const { settled } = track(pending);

    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(attempts).toBe(3);

    await expect(pending).rejects.toThrow("500");
    expect(settled()).toBe(true);
  });
});

describe("describePool", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    fake.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports per-key state and totals without exposing key material", async () => {
    fake.env.groqApiKeys = ["k0", "k1"];
    await withGroqKey(async () => "ok");
    fake.state.cooldowns.push({
      keyIndex: 1,
      exhaustedUntil: new Date(START.getTime() + 60_000),
    });

    const pool = await describePool();

    expect(pool.keys).toHaveLength(2);
    expect(pool.keys[0]).toMatchObject({
      keyIndex: 0,
      rollingCount: 1,
      dailyCount: 1,
      available: true,
    });
    expect(pool.keys[1]?.available).toBe(false);
    expect(pool.totals).toEqual({
      keys: 2,
      available: 1,
      exhausted: 1,
      dailyCount: 1,
      rollingCount: 1,
    });
    expect(JSON.stringify(pool)).not.toContain("k0");
    expect(JSON.stringify(pool)).not.toContain("k1");
  });
});
