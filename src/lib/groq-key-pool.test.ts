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
    id?: string;
    keyIndex: number;
    createdAt: Date;
    tokens?: number;
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
    nextId: 0,
  };

  const env = {
    groqApiKeys: ["k0", "k1", "k2", "k3"] as string[],
    groqKeyRpd: 1000,
    groqKeyRpm: 30,
    groqKeyTpm: 8000,
    groqPoolTpd: 200_000,
    queueMaxWaitMs: 12_000,
    queuePollMs: 300,
  };

  const reset = (): void => {
    state.logs = [];
    state.daily = [];
    state.cooldowns = [];
    state.prunes = 0;
    state.nextId = 0;
    env.groqApiKeys = ["k0", "k1", "k2", "k3"];
    env.groqKeyRpd = 1000;
    env.groqKeyRpm = 30;
    env.groqKeyTpm = 8000;
    env.groqPoolTpd = 200_000;
    env.queueMaxWaitMs = 12_000;
    env.queuePollMs = 300;
  };

  const client = {
    $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      // Positional, exactly as the real query is built: the sliding-minute
      // window start first, the trailing-day window start second, today's UTC
      // date always last. Parsing them by position keeps this fake honest about
      // what the pool actually sends.
      const minuteSince = values[0] as Date;
      const daySince = values[1] as Date;
      const today = values[values.length - 1] as Date;
      const indices = new Set<number>();
      for (const log of state.logs) indices.add(log.keyIndex);
      for (const row of state.daily) indices.add(row.keyIndex);
      for (const row of state.cooldowns) indices.add(row.keyIndex);
      return [...indices].sort((a, b) => a - b).map((keyIndex) => {
        const windowed = state.logs.filter(
          (log) => log.keyIndex === keyIndex && log.createdAt.getTime() > minuteSince.getTime(),
        );
        const trailingDay = state.logs.filter(
          (log) => log.keyIndex === keyIndex && log.createdAt.getTime() > daySince.getTime(),
        );
        const daily = state.daily.find(
          (row) => row.keyIndex === keyIndex && row.date.getTime() === today.getTime(),
        );
        const cooldown = state.cooldowns.find((row) => row.keyIndex === keyIndex);
        return {
          keyIndex,
          rollingCount: windowed.length,
          rollingTokens: windowed.reduce((sum, log) => sum + (log.tokens ?? 0), 0),
          lastRequestAt:
            windowed.length > 0
              ? new Date(Math.max(...windowed.map((log) => log.createdAt.getTime())))
              : null,
          dailyCount: trailingDay.length,
          dailyTokens: trailingDay.reduce((sum, log) => sum + (log.tokens ?? 0), 0),
          calendarCount: daily?.count ?? 0,
          exhaustedUntil: cooldown?.exhaustedUntil ?? null,
        };
      });
    },
    apiKeyRequestLog: {
      create: async (args: { data: { keyIndex: number } }) => {
        state.nextId += 1;
        const row: LogRow = {
          id: `log-${state.nextId}`,
          keyIndex: args.data.keyIndex,
          createdAt: new Date(),
          tokens: 0,
        };
        state.logs.push(row);
        return { ...row };
      },
      update: async (args: { where: { id: string }; data: { tokens: number } }) => {
        const row = state.logs.find((log) => log.id === args.where.id);
        if (row !== undefined) {
          row.tokens = args.data.tokens;
        }
        return row ?? null;
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

/**
 * A 429 that Groq raised on the token budget rather than the request budget,
 * carrying the real header shapes: `retry-after` in seconds and
 * `x-ratelimit-reset-tokens` as a duration.
 */
function tokenLimitError(retryAfterSeconds: number | null, tokenReset: string | null): Error {
  const headers = new Headers();
  if (retryAfterSeconds !== null) {
    headers.set("retry-after", String(retryAfterSeconds));
  }
  if (tokenReset !== null) {
    headers.set("x-ratelimit-reset-tokens", tokenReset);
  }
  return Object.assign(
    new Error(
      "Rate limit reached for openai/gpt-oss-120b on tokens per minute (TPM): Limit 8000, Used 8123",
    ),
    { status: 429, headers },
  );
}

/**
 * The 429 Groq returns once the organization's shared daily token budget is
 * gone, verbatim in shape: it names the org, the TPD limit, and the reset.
 */
function poolDailyLimitError(): Error {
  return Object.assign(
    new Error(
      "Rate limit reached for model `openai/gpt-oss-120b` in organization " +
        "`org_01m3be03f0ev1s5mpvq690fe2s` service tier `on_demand` on tokens per day (TPD): " +
        "Limit 200000, Used 198806, Requested 20077. Please try again in 2h15m57.456s.",
    ),
    { status: 429 },
  );
}

/** 2h15m57.456s, the reset the measured TPD refusal stated. */
const POOL_RESET_MS = 2 * 3_600_000 + 15 * 60_000 + 57_456;

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

  it("skips a key that has request capacity but no token capacity", async () => {
    fake.env.groqApiKeys = ["k0", "k1"];
    fake.env.groqKeyTpm = 3000;
    // Key 0 is the least recently used key -- key 1 was used ten seconds later
    // -- so it would win the ordering outright. It has spent its whole 3000
    // token minute on a single request, nowhere near its 30 request cap.
    fake.state.logs.push({ keyIndex: 0, createdAt: new Date(START.getTime() - 30_000), tokens: 3000 });
    fake.state.logs.push({ keyIndex: 1, createdAt: new Date(START.getTime() - 10_000), tokens: 500 });

    const pool = await describePool();
    expect(pool.keys[0]).toMatchObject({ rollingCount: 1, available: false });
    expect(pool.keys[1]?.available).toBe(true);

    const used: number[] = [];
    await withGroqKey(async (_client, keyIndex) => {
      used.push(keyIndex);
      return "ok";
    });

    // Token capacity, not recency, decided this: key 0 was passed over.
    expect(used).toEqual([1]);
    expect(fake.state.logs.filter((log) => log.keyIndex === 0)).toHaveLength(1);
  });

  it("records the token cost the caller reports and holds it against the minute window", async () => {
    fake.env.groqApiKeys = ["k0"];
    fake.env.groqKeyTpm = 3000;

    await withGroqKey(async (_client, _keyIndex, reportTokens) => {
      reportTokens?.(2000);
      return "ok";
    });
    await withGroqKey(async (_client, _keyIndex, reportTokens) => {
      reportTokens?.(1000);
      return "ok";
    });

    expect(fake.state.logs.map((log) => log.tokens)).toEqual([2000, 1000]);

    // The key's whole 3000-token minute is spent, so a further request queues
    // even though only two of its 30 requests are used.
    const pending = withGroqKey(async () => "ok");
    const { settled, rejection } = track(pending);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(settled()).toBe(false);
    expect(fake.state.logs).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(rejection()).toBeInstanceOf(GuardianBusyError);
  });

  it("waits for a saturated token window to drain instead of failing immediately", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    fake.env.groqApiKeys = ["k0"];
    fake.env.groqKeyTpm = 1000;
    fake.env.queueMaxWaitMs = 120_000;
    // The key's whole token budget went 30 seconds ago, so the window reopens
    // in another 30. The pool must queue for that, not declare itself busy.
    fake.state.logs.push({ keyIndex: 0, createdAt: new Date(START.getTime() - 30_000), tokens: 1000 });

    const pending = withGroqKey(async () => "ok");
    const { settled, rejection } = track(pending);

    await vi.advanceTimersByTimeAsync(29_000);
    expect(settled()).toBe(false);
    expect(rejection()).toBeNull();

    await vi.advanceTimersByTimeAsync(2_000);
    await expect(pending).resolves.toBe("ok");
    expect(rejection()).toBeNull();
  });

  it("counts a request 23 hours old against the daily cap, so the key is skipped", async () => {
    fake.env.groqApiKeys = ["k0"];
    fake.env.groqKeyRpd = 1;
    fake.state.logs.push({ keyIndex: 0, createdAt: new Date(START.getTime() - 23 * 60 * 60_000) });

    // Inside the trailing 24 hours, so the key's single daily request is spent.
    const pending = withGroqKey(async () => "never");
    const { settled, rejection } = track(pending);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(settled()).toBe(false);
    expect(fake.state.logs).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(rejection()).toBeInstanceOf(GuardianBusyError);
    expect(fake.state.logs).toHaveLength(1);
  });

  it("does not count a request 25 hours old against the daily cap", async () => {
    fake.env.groqApiKeys = ["k0"];
    fake.env.groqKeyRpd = 1;
    const stale = new Date(START.getTime() - 25 * 60 * 60_000);
    fake.state.logs.push({ keyIndex: 0, createdAt: stale });

    // With rpd at 1, a calendar day or any window longer than 24 hours would
    // have refused this call outright.
    await expect(withGroqKey(async () => "ok")).resolves.toBe("ok");

    // The stale row is still in the table -- retention is 25 hours, so it has
    // not been pruned -- which means the trailing-day filter is what excluded
    // it. Only the request just made counts, and that is what makes this a
    // rolling window rather than a UTC-midnight reset.
    expect(fake.state.logs.some((log) => log.createdAt.getTime() === stale.getTime())).toBe(true);
    const pool = await describePool();
    expect(pool.keys[0]?.dailyCount).toBe(1);
  });

  it("retires a token-limit 429 for the token window and retries on the next key", async () => {
    fake.env.groqApiKeys = ["k0", "k1"];
    const attempts: number[] = [];

    const result = await withGroqKey(async (_client, keyIndex) => {
      attempts.push(keyIndex);
      if (attempts.length === 1) {
        throw tokenLimitError(1, "24.577s");
      }
      return "ok";
    });

    expect(result).toBe("ok");
    expect(attempts).toEqual([0, 1]);
    expect(fake.state.cooldowns).toHaveLength(1);
    // The measured token window (24.577s), not the 1-second retry-after: the
    // key is fine on requests and only needs its tokens to drain.
    expect(fake.state.cooldowns[0]?.keyIndex).toBe(0);
    expect(fake.state.cooldowns[0]?.exhaustedUntil.getTime()).toBe(START.getTime() + 24_577);

    const pool = await describePool();
    expect(pool.keys[0]?.available).toBe(false);
    expect(pool.keys[1]?.available).toBe(true);
  });

  it("falls back to retry-after on a token 429 that names no token window", async () => {
    fake.env.groqApiKeys = ["k0", "k1"];

    await withGroqKey(async (_client, keyIndex) => {
      if (keyIndex === 0) {
        throw tokenLimitError(12, null);
      }
      return "ok";
    });

    expect(fake.state.cooldowns[0]?.exhaustedUntil.getTime()).toBe(START.getTime() + 12_000);
  });

  it("treats the daily token budget as one shared budget, not one per key", async () => {
    fake.env.groqApiKeys = ["k0", "k1", "k2", "k3"];
    fake.env.groqPoolTpd = 5000;
    // 5500 tokens spread over two keys, both a minute old. No key is near its
    // own 8000-token minute and none has more than one request in the day --
    // per-key accounting alone would call every key in this pool available.
    fake.state.logs.push({ keyIndex: 0, createdAt: new Date(START.getTime() - 60_000), tokens: 3000 });
    fake.state.logs.push({ keyIndex: 1, createdAt: new Date(START.getTime() - 60_000), tokens: 2500 });

    const pool = await describePool();
    expect(pool.totals.available).toBe(0);
    expect(pool.keys[2]).toMatchObject({ rollingCount: 0, dailyCount: 0, available: false });

    // With the org budget spent there is nothing to queue for, so the call
    // fails gracefully at the deadline rather than burning a 429.
    const pending = withGroqKey(async () => "never");
    const { settled, rejection } = track(pending);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(settled()).toBe(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(rejection()).toBeInstanceOf(GuardianBusyError);
    expect(fake.state.logs).toHaveLength(2);
  });

  it("retires the whole pool, not one key, when Groq reports the daily budget is spent", async () => {
    fake.env.groqApiKeys = ["k0", "k1", "k2", "k3"];
    const attempts: number[] = [];

    const pending = withGroqKey(async (_client, keyIndex) => {
      attempts.push(keyIndex);
      throw poolDailyLimitError();
    });
    const { rejection } = track(pending);

    await vi.advanceTimersByTimeAsync(13_000);

    expect(rejection()).toBeInstanceOf(GuardianBusyError);
    // One refusal was enough to stop all four keys, because another key would
    // draw on the same organization budget.
    expect(attempts).toEqual([0]);
    expect(fake.state.cooldowns).toHaveLength(4);
    for (const cooldown of fake.state.cooldowns) {
      // The reset Groq stated in the body (2h15m57.456s), not a minute-scale
      // fallback -- retrying sooner would only collect another refusal.
      expect(cooldown.exhaustedUntil.getTime()).toBe(START.getTime() + POOL_RESET_MS);
    }

    const pool = await describePool();
    expect(pool.totals.available).toBe(0);
    expect(pool.totals.exhausted).toBe(4);
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

  it("does not retry an error that declares itself non-retryable", async () => {
    fake.env.groqApiKeys = ["k0"];
    // Shape of GuardianUnavailableError: the reply arrived but carried no
    // content. Retrying would spend two more units of quota on the same empty
    // answer, so the pool must hand it straight to the caller.
    const unrecoverable = Object.assign(new Error("empty completion"), {
      retryable: false,
    });
    let attempts = 0;
    const pending = withGroqKey(async () => {
      attempts += 1;
      throw unrecoverable;
    });
    const { settled } = track(pending);

    await vi.advanceTimersByTimeAsync(5_000);

    expect(attempts).toBe(1);
    expect(settled()).toBe(true);
    await expect(pending).rejects.toBe(unrecoverable);
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
