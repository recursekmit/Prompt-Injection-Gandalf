import Groq from "groq-sdk";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

/**
 * Thrown when no key in the pool has capacity before the queue deadline. The
 * route maps it to a friendly 503; it never carries Groq's own error text.
 */
export class GuardianBusyError extends Error {
  constructor(message = "The guardian is overwhelmed. Wait a moment and try again.") {
    super(message);
    this.name = "GuardianBusyError";
  }
}

/** Length of the sliding per-minute window, matching Groq's own RPM window. */
const WINDOW_MS = 60_000;
/** Request-log rows older than this are useless for the window and pruned. */
const LOG_MAX_AGE_MS = 5 * 60_000;
/** The prune runs at most this often, so it does not dominate the hot path. */
const PRUNE_THROTTLE_MS = 60_000;
/** Fallback cooldown when Groq sends a 429 without a usable retry-after. */
const DEFAULT_COOLDOWN_MS = 55_000;
/** Backoff before the 2nd and 3rd attempt at a 5xx or network failure. */
const RETRY_BACKOFF_MS: readonly number[] = [250, 500];
/** Total attempts (first call included) allowed for 5xx / network errors. */
const MAX_NETWORK_ATTEMPTS = 3;
/** Jitter added to each poll so queued requests do not stampede together. */
const POLL_JITTER_MS = 100;

/**
 * One Groq client per configured key index. Built lazily because constructing
 * a client is only worth it for keys the pool actually hands out.
 */
const clients = new Map<number, Groq>();

/**
 * Timestamp of the last request-log prune. Module-level so the throttle is per
 * process; with several Next workers each prunes at most once a minute, which
 * is still proportional to traffic rather than to lifetime volume.
 */
let lastPrunedAt = 0;

/** The subset of the Prisma client (or transaction client) this module needs. */
interface MetricDb {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

/** Raw row shape returned by the metrics query below. */
interface MetricRow {
  keyIndex: number;
  rollingCount: number;
  lastRequestAt: Date | null;
  dailyCount: number;
  exhaustedUntil: Date | null;
}

/** A pool key's metrics with the "may be used right now" verdict attached. */
export interface PoolKeyStatus {
  keyIndex: number;
  dailyCount: number;
  rollingCount: number;
  exhaustedUntil: Date | null;
  available: boolean;
}

/** Internal metric view: the public status plus the ordering key. */
interface MetricView extends PoolKeyStatus {
  /** Epoch millis of the last request inside the window, or null if none. */
  lastRequestAt: number | null;
}

/** Pool-wide totals for the admin endpoint. Never contains key material. */
export interface PoolStatus {
  keys: PoolKeyStatus[];
  totals: {
    keys: number;
    available: number;
    exhausted: number;
    dailyCount: number;
    rollingCount: number;
  };
}

/** Midnight UTC of the current day, matching the `@db.Date` daily counter. */
function todayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Indices of every configured key; the pool size is never assumed. */
function poolIndices(): number[] {
  return env.groqApiKeys.map((_, index) => index);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * HTTP status of a Groq SDK error, if it has one. Duck-typed rather than
 * `instanceof Groq.APIError` so the pool does not care which SDK error
 * subclass the failure arrived as.
 */
function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function isRateLimitError(error: unknown): boolean {
  return statusOf(error) === 429;
}

function isRetryableError(error: unknown): boolean {
  // An error may state its own retryability. Domain errors use this: a reply
  // that arrived but carried no content is not a transport failure, and
  // retrying it would spend quota on an answer that was already empty.
  if (
    typeof error === "object" &&
    error !== null &&
    (error as { retryable?: unknown }).retryable === false
  ) {
    return false;
  }
  const status = statusOf(error);
  if (status !== undefined) {
    return status >= 500;
  }
  // No HTTP status at all means the request never landed (DNS, socket, timeout).
  return true;
}

/**
 * `retry-after` from a Groq error, in milliseconds. Accepts either a `Headers`
 * instance or a plain header record, and only trusts a positive number of
 * seconds; anything else falls back to the default cooldown.
 */
function retryAfterMs(error: unknown): number {
  if (typeof error !== "object" || error === null) {
    return DEFAULT_COOLDOWN_MS;
  }
  const headers = (error as { headers?: unknown }).headers;
  let raw: string | null | undefined;
  if (headers instanceof Headers) {
    raw = headers.get("retry-after");
  } else if (typeof headers === "object" && headers !== null) {
    const value = (headers as Record<string, unknown>)["retry-after"];
    raw = typeof value === "string" ? value : undefined;
  }
  if (raw === undefined || raw === null) {
    return DEFAULT_COOLDOWN_MS;
  }
  const seconds = Number.parseFloat(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return DEFAULT_COOLDOWN_MS;
  }
  return Math.round(seconds * 1000);
}

/**
 * Reads rolling count, last request time, daily count and cooldown for every
 * configured key. One raw query because the sliding-window aggregate is a
 * correlated count Prisma's fluent API cannot express without N round trips.
 * Keys with no rows at all are absent from the result and defaulted below.
 */
async function readMetrics(db: MetricDb, now: Date): Promise<MetricView[]> {
  const since = new Date(now.getTime() - WINDOW_MS);
  const today = todayUtc(now);
  const rows = await db.$queryRaw<MetricRow[]>`
    SELECT i."keyIndex" AS "keyIndex",
           (SELECT COUNT(*) FROM "ApiKeyRequestLog" l
             WHERE l."keyIndex" = i."keyIndex" AND l."createdAt" > ${since})::int AS "rollingCount",
           (SELECT MAX(l."createdAt") FROM "ApiKeyRequestLog" l
             WHERE l."keyIndex" = i."keyIndex" AND l."createdAt" > ${since}) AS "lastRequestAt",
           COALESCE((SELECT u.count FROM "ApiKeyDailyUsage" u
             WHERE u."keyIndex" = i."keyIndex" AND u.date = ${today}::date), 0)::int AS "dailyCount",
           (SELECT c."exhaustedUntil" FROM "ApiKeyCooldown" c
             WHERE c."keyIndex" = i."keyIndex") AS "exhaustedUntil"
    FROM (SELECT DISTINCT "keyIndex" FROM "ApiKeyRequestLog"
          UNION SELECT DISTINCT "keyIndex" FROM "ApiKeyDailyUsage"
          UNION SELECT DISTINCT "keyIndex" FROM "ApiKeyCooldown") i
  `;

  const byIndex = new Map<number, MetricRow>(rows.map((row) => [row.keyIndex, row]));

  return poolIndices().map((keyIndex) => {
    const row = byIndex.get(keyIndex);
    const rollingCount = row?.rollingCount ?? 0;
    const dailyCount = row?.dailyCount ?? 0;
    const exhaustedUntil = row?.exhaustedUntil ?? null;
    return {
      keyIndex,
      rollingCount,
      dailyCount,
      exhaustedUntil,
      // A key with no request inside the window is as free as one that has
      // never been used, so both sort ahead of a key used a second ago.
      lastRequestAt: row?.lastRequestAt?.getTime() ?? null,
      available:
        rollingCount < env.groqKeyRpm &&
        dailyCount < env.groqKeyRpd &&
        (exhaustedUntil === null || exhaustedUntil.getTime() <= now.getTime()),
    };
  });
}

/**
 * Picks the least-recently-used key among those with capacity, tie-broken by
 * lowest daily count. Ordering is done in TypeScript over the metric rows so
 * the same rule drives both the reservation and `describePool`.
 */
function pickCandidate(metrics: MetricView[]): number | null {
  const available = metrics.filter((metric) => metric.available);
  if (available.length === 0) {
    return null;
  }
  available.sort((a, b) => {
    const aLast = a.lastRequestAt ?? Number.NEGATIVE_INFINITY;
    const bLast = b.lastRequestAt ?? Number.NEGATIVE_INFINITY;
    if (aLast !== bLast) {
      return aLast - bLast;
    }
    if (a.dailyCount !== b.dailyCount) {
      return a.dailyCount - b.dailyCount;
    }
    return a.keyIndex - b.keyIndex;
  });
  return available[0].keyIndex;
}

/**
 * Reserves a key by inserting its request-log row and bumping today's counter.
 * Running both inside one transaction with the insert as the serialisation
 * point is what stops two concurrent requests claiming the same free key: the
 * loser re-reads the metrics and picks the next key.
 */
async function reserveKey(now: Date): Promise<number | null> {
  return prisma.$transaction(async (tx) => {
    // Prune is throttled to at most once a minute by the module timestamp.
    if (now.getTime() - lastPrunedAt >= PRUNE_THROTTLE_MS) {
      lastPrunedAt = now.getTime();
      await tx.apiKeyRequestLog.deleteMany({
        where: { createdAt: { lt: new Date(now.getTime() - LOG_MAX_AGE_MS) } },
      });
    }

    const metrics = await readMetrics(tx, now);
    const keyIndex = pickCandidate(metrics);
    if (keyIndex === null) {
      return null;
    }

    await tx.apiKeyRequestLog.create({ data: { keyIndex } });
    const date = todayUtc(now);
    await tx.apiKeyDailyUsage.upsert({
      where: { keyIndex_date: { keyIndex, date } },
      create: { keyIndex, date, count: 1 },
      update: { count: { increment: 1 } },
    });
    return keyIndex;
  });
}

/** Puts a key Groq itself rate-limited into cooldown until `ms` from now. */
async function coolDown(keyIndex: number, ms: number): Promise<void> {
  const exhaustedUntil = new Date(Date.now() + ms);
  await prisma.apiKeyCooldown.upsert({
    where: { keyIndex },
    create: { keyIndex, exhaustedUntil },
    update: { exhaustedUntil },
  });
}

/** Cached client for a key index; the key itself never leaves this function. */
function clientFor(keyIndex: number): Groq {
  const cached = clients.get(keyIndex);
  if (cached !== undefined) {
    return cached;
  }
  const apiKey = env.groqApiKeys[keyIndex];
  if (apiKey === undefined) {
    throw new GuardianBusyError();
  }
  const client = new Groq({ apiKey });
  clients.set(keyIndex, client);
  return client;
}

/**
 * Runs `fn` against a key with spare capacity, reserving that key first.
 *
 * Loops until `env.queueMaxWaitMs` elapses: no capacity means sleep, not
 * failure, because a brief wait is invisible to the player while a thrown
 * GuardianBusyError is a visible 503. A 429 trusts Groq over the local ledger,
 * cooling the key down and retrying on the next one; 5xx and network errors get
 * three attempts with backoff.
 */
export async function withGroqKey<T>(
  fn: (client: Groq, keyIndex: number) => Promise<T>,
): Promise<T> {
  const deadline = Date.now() + env.queueMaxWaitMs;
  let networkAttempts = 0;

  while (true) {
    const now = new Date();
    const keyIndex = await reserveKey(now);

    if (keyIndex === null) {
      if (Date.now() >= deadline) {
        throw new GuardianBusyError();
      }
      const jitter = Math.round((Math.random() * 2 - 1) * POLL_JITTER_MS);
      // Never sleep past the deadline. Without the clamp the final sleep always
      // overshoots by up to poll + jitter, so the queue outlives its own cap.
      const remaining = deadline - Date.now();
      await sleep(Math.min(env.queuePollMs + jitter, remaining));
      continue;
    }

    try {
      return await fn(clientFor(keyIndex), keyIndex);
    } catch (error) {
      if (isRateLimitError(error)) {
        await coolDown(keyIndex, retryAfterMs(error));
        if (Date.now() >= deadline) {
          throw new GuardianBusyError();
        }
        continue;
      }
      if (isRetryableError(error)) {
        networkAttempts += 1;
        if (networkAttempts >= MAX_NETWORK_ATTEMPTS) {
          throw error;
        }
        const backoff = RETRY_BACKOFF_MS[networkAttempts - 1] ?? 1000;
        await sleep(backoff);
        continue;
      }
      throw error;
    }
  }
}

/**
 * Snapshot of pool health for the admin endpoint. Returns counts and states
 * only: no part of any API key is read, returned, or logged here.
 */
export async function describePool(): Promise<PoolStatus> {
  const now = new Date();
  const metrics = await prisma.$transaction((tx) => readMetrics(tx, now));
  const keys: PoolKeyStatus[] = metrics.map((metric) => ({
    keyIndex: metric.keyIndex,
    dailyCount: metric.dailyCount,
    rollingCount: metric.rollingCount,
    exhaustedUntil: metric.exhaustedUntil,
    available: metric.available,
  }));
  return {
    keys,
    totals: {
      keys: keys.length,
      available: keys.filter((key) => key.available).length,
      exhausted: keys.filter(
        (key) => key.exhaustedUntil !== null && key.exhaustedUntil.getTime() > now.getTime(),
      ).length,
      dailyCount: keys.reduce((sum, key) => sum + key.dailyCount, 0),
      rollingCount: keys.reduce((sum, key) => sum + key.rollingCount, 0),
    },
  };
}
