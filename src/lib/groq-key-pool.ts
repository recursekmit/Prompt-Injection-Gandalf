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

/** Length of the sliding per-minute window, matching Groq's own RPM/TPM window. */
const WINDOW_MS = 60_000;
/**
 * Length of the trailing daily window. Groq's `x-ratelimit-reset-requests` is a
 * duration (measured: 3h27m at 07:10 UTC), not a countdown to midnight, so the
 * quota is a rolling window and the trailing count is the honest model. A
 * calendar-day reset would credit the pool a fresh budget while Groq is still
 * counting yesterday's requests, and vice versa.
 */
const DAY_WINDOW_MS = 24 * 60 * 60_000;
/**
 * Request-log rows older than this are pruned. It must exceed DAY_WINDOW_MS or
 * the prune would destroy the trailing-24-hour window it feeds, and it is what
 * bounds the table: a key can log at most `groqKeyRpd` rows in that span, so
 * the whole table holds roughly `keys * groqKeyRpd` rows (about 4000 for the
 * four-key pool) with no growth over time.
 */
const LOG_MAX_AGE_MS = DAY_WINDOW_MS + 60 * 60_000;
/** The prune runs at most this often, so it does not dominate the hot path. */
const PRUNE_THROTTLE_MS = 60_000;
/** Fallback cooldown when Groq sends a 429 without a usable retry-after. */
const DEFAULT_COOLDOWN_MS = 55_000;
/**
 * Fallback cooldown for a "tokens per day" refusal that states no reset. A
 * daily budget does not come back within the minute-scale retry-after, so
 * retrying every 55s would spend requests on refusals Groq has already
 * guaranteed. Half an hour is deliberately blunt; Groq normally states the
 * reset, and this only covers a malformed body.
 */
const DEFAULT_POOL_COOLDOWN_MS = 30 * 60_000;
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
  rollingTokens: number;
  lastRequestAt: Date | null;
  dailyCount: number;
  dailyTokens: number;
  calendarCount: number;
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

/** Internal metric view: the public status plus the ordering key and the token
 * total, which is a gate but not part of the reported status. */
interface MetricView extends PoolKeyStatus {
  /** Tokens spent by this key inside the sliding minute, from the request log. */
  rollingTokens: number;
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

/**
 * Midnight UTC of the current day, matching the `@db.Date` daily counter. Only
 * used for the redundant calendar cap below; the daily budget the pool actually
 * enforces is the trailing 24 hours, not this bucket.
 */
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

/**
 * True when a 429 is about the token budget rather than the request budget.
 * Groq's error text names the budget it refused on ("Rate limit reached ... on
 * tokens per minute (TPM)" versus "... on requests per minute (RPM)"), so the
 * message is the reliable signal -- there is no separate status code for the two.
 */
function isTokenLimitError(error: unknown): boolean {
  if (!isRateLimitError(error)) {
    return false;
  }
  const message = error instanceof Error ? error.message : "";
  return /token/i.test(message);
}

/** Milliseconds in each unit Groq uses in its `x-ratelimit-reset-*` headers. */
const DURATION_UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};
/** Matches one "<number><unit>" chunk of a duration, e.g. the `3h27m21.599s` shape. */
const DURATION_PART = /(\d+(?:\.\d+)?)(ms|s|m|h|d)/g;

/**
 * Parses Groq's duration header format ("24.577s", "3h27m21.599s") into
 * milliseconds. Returns null when nothing parseable is present, so the caller
 * can fall back rather than trusting a zero.
 */
function parseDurationMs(raw: string | null): number | null {
  if (raw === null) {
    return null;
  }
  let total = 0;
  let matched = false;
  for (const part of raw.matchAll(DURATION_PART)) {
    matched = true;
    total += Number.parseFloat(part[1]) * (DURATION_UNIT_MS[part[2]] ?? 0);
  }
  return matched && Number.isFinite(total) && total > 0 ? Math.round(total) : null;
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

/** Reads one response header off a Groq error, from a Headers or a plain record. */
function headerValue(error: unknown, name: string): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const headers = (error as { headers?: unknown }).headers;
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  if (typeof headers === "object" && headers !== null) {
    const value = (headers as Record<string, unknown>)[name];
    return typeof value === "string" ? value : null;
  }
  return null;
}

/**
 * True when a 429 says the organization's daily token budget is spent. This is
 * a different failure from a per-key limit: it cannot be escaped by using
 * another key, and Groq states only in the error body how long it lasts.
 */
function isPoolDailyLimitError(error: unknown): boolean {
  if (!isRateLimitError(error)) {
    return false;
  }
  const message = error instanceof Error ? error.message : "";
  return /tokens per day|\(TPD\)/i.test(message);
}

/** Groq's own "try again in <duration>" from a 429 body, in milliseconds. */
function statedResetMs(error: unknown): number | null {
  const message = error instanceof Error ? error.message : "";
  const match = /try again in\s+([0-9hmsd.]+)/i.exec(message);
  return match === null ? null : parseDurationMs(match[1]);
}

/**
 * How long to retire a key Groq just refused with a 429.
 *
 * Both a request-rate 429 and a token-limit 429 take the key out of service for
 * the window Groq named -- locally the key may look idle either way, and Groq's
 * clock is the authority. Preference order: the duration Groq states in the
 * body, then `x-ratelimit-reset-tokens` for a token refusal (the measured value
 * was ~24.6s, and waiting out the token window is exactly what makes the key
 * usable again), then `retry-after`, then the caller's fallback.
 */
function cooldownMsFor(error: unknown, fallback = DEFAULT_COOLDOWN_MS): number {
  const stated = statedResetMs(error);
  if (stated !== null) {
    return stated;
  }
  if (isTokenLimitError(error)) {
    const tokenReset = parseDurationMs(headerValue(error, "x-ratelimit-reset-tokens"));
    if (tokenReset !== null) {
      return tokenReset;
    }
  }
  const raw = headerValue(error, "retry-after");
  if (raw !== null) {
    const seconds = Number.parseFloat(raw);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.round(seconds * 1000);
    }
  }
  return fallback;
}

/**
 * Reads request count, token total, last request time, daily count and cooldown
 * for every configured key. One raw query because the sliding-window aggregates
 * are correlated counts Prisma's fluent API cannot express without N round
 * trips. Keys with no rows at all are absent from the result and defaulted below.
 *
 * Parameters are positional and in this order: the minute-window start, the
 * trailing-day window start, then today's UTC date. The test doubles parse them
 * that way, so the order is part of the contract.
 */
async function readMetrics(db: MetricDb, now: Date): Promise<MetricView[]> {
  const minuteSince = new Date(now.getTime() - WINDOW_MS);
  const daySince = new Date(now.getTime() - DAY_WINDOW_MS);
  const today = todayUtc(now);
  const rows = await db.$queryRaw<MetricRow[]>`
    SELECT i."keyIndex" AS "keyIndex",
           COALESCE(m."rollingCount", 0) AS "rollingCount",
           COALESCE(m."rollingTokens", 0) AS "rollingTokens",
           m."lastRequestAt" AS "lastRequestAt",
           COALESCE(d."dailyCount", 0) AS "dailyCount",
           COALESCE(k."calendarCount", 0) AS "calendarCount",
           c."exhaustedUntil" AS "exhaustedUntil"
    FROM (SELECT DISTINCT "keyIndex" FROM "ApiKeyRequestLog"
          UNION SELECT DISTINCT "keyIndex" FROM "ApiKeyDailyUsage"
          UNION SELECT DISTINCT "keyIndex" FROM "ApiKeyCooldown") i
    LEFT JOIN (SELECT l."keyIndex" AS "keyIndex",
                      COUNT(*)::int AS "rollingCount",
                      SUM(l."tokens")::int AS "rollingTokens",
                      MAX(l."createdAt") AS "lastRequestAt"
               FROM "ApiKeyRequestLog" l
               WHERE l."createdAt" > ${minuteSince}
               GROUP BY l."keyIndex") m ON m."keyIndex" = i."keyIndex"
    LEFT JOIN (SELECT l."keyIndex" AS "keyIndex",
                      COUNT(*)::int AS "dailyCount",
                      SUM(l."tokens")::int AS "dailyTokens"
               FROM "ApiKeyRequestLog" l
               WHERE l."createdAt" > ${daySince}
               GROUP BY l."keyIndex") d ON d."keyIndex" = i."keyIndex"
    LEFT JOIN (SELECT u."keyIndex" AS "keyIndex", u."count" AS "calendarCount"
               FROM "ApiKeyDailyUsage" u
               WHERE u.date = ${today}::date) k ON k."keyIndex" = i."keyIndex"
    LEFT JOIN "ApiKeyCooldown" c ON c."keyIndex" = i."keyIndex"
  `;

  const byIndex = new Map<number, MetricRow>(rows.map((row) => [row.keyIndex, row]));

  // Groq's daily token budget is shared by the whole organization, so it is
  // summed across every key rather than gated per key. Every log row in the
  // trailing day belongs to a key present in the query's UNION (including keys
  // that have since been removed from GROQ_API_KEYS, whose tokens still count
  // against the org), so this total is complete.
  const poolDailyTokens = rows.reduce((total, row) => total + (row.dailyTokens ?? 0), 0);
  const poolOverBudget = poolDailyTokens >= env.groqPoolTpd;

  return poolIndices().map((keyIndex) => {
    const row = byIndex.get(keyIndex);
    const rollingCount = row?.rollingCount ?? 0;
    const rollingTokens = row?.rollingTokens ?? 0;
    // The trailing 24 hours is the window Groq actually enforces. The calendar
    // aggregate is a redundant cap kept alongside it: it survives log pruning,
    // so a bug in the retention code cannot let a key exceed its daily budget.
    // Because every request made on the current UTC day falls inside the
    // trailing 24 hours, this can only ever make the pool more conservative --
    // it can never make it believe it has budget that Groq would refuse.
    const dailyCount = Math.max(row?.dailyCount ?? 0, row?.calendarCount ?? 0);
    const exhaustedUntil = row?.exhaustedUntil ?? null;
    return {
      keyIndex,
      rollingCount,
      rollingTokens,
      dailyCount,
      exhaustedUntil,
      // A key with no request inside the window is as free as one that has
      // never been used, so both sort ahead of a key used a second ago.
      lastRequestAt: row?.lastRequestAt?.getTime() ?? null,
      available:
        !poolOverBudget &&
        rollingCount < env.groqKeyRpm &&
        rollingTokens < env.groqKeyTpm &&
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
 *
 * Returns the reserved key and the id of its log row, so the token cost of the
 * call can be written back onto that same row once the completion returns.
 */
async function reserveKey(now: Date): Promise<{ keyIndex: number; logId: string } | null> {
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

    // Created with no token cost: the row has to exist before the call so it
    // serialises concurrent reservations, and the cost is unknown until the
    // completion comes back. `recordTokenUsage` fills it in afterwards.
    const log = await tx.apiKeyRequestLog.create({ data: { keyIndex } });
    const date = todayUtc(now);
    await tx.apiKeyDailyUsage.upsert({
      where: { keyIndex_date: { keyIndex, date } },
      create: { keyIndex, date, count: 1 },
      update: { count: { increment: 1 } },
    });
    return { keyIndex, logId: log.id };
  });
}

/** Writes the token cost of a finished call back onto its reserved log row. */
async function recordTokenUsage(logId: string, tokens: number): Promise<void> {
  await prisma.apiKeyRequestLog.update({ where: { id: logId }, data: { tokens } });
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

/**
 * Puts the whole pool into cooldown until `ms` from now.
 *
 * The daily token budget is per organization, so a "tokens per day" refusal is
 * not something another key can work around -- every key draws on the same
 * budget and would be refused identically. The pool is therefore retired key by
 * key, which is the gate the reservation loop already reads. This assumes the
 * keys in GROQ_API_KEYS all belong to one organization (true of the measured
 * pool: four keys, one org id); keys from a second organization would need
 * separate accounting.
 */
async function coolDownPool(ms: number): Promise<void> {
  await Promise.all(poolIndices().map((keyIndex) => coolDown(keyIndex, ms)));
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
 * cooling the key down -- for the token window when the refusal was about
 * tokens, and the entire pool when it was about the organization's daily token
 * budget -- and retrying on the next key; 5xx and network errors get three
 * attempts with backoff.
 *
 * `fn` may report the token cost of its call through the third argument. The
 * reporter is per attempt, so a retry on a different key never charges the key
 * that was refused.
 */
export async function withGroqKey<T>(
  fn: (
    client: Groq,
    keyIndex: number,
    reportTokens?: (tokens: number) => void,
  ) => Promise<T>,
): Promise<T> {
  const deadline = Date.now() + env.queueMaxWaitMs;
  let networkAttempts = 0;

  while (true) {
    const now = new Date();
    const reserved = await reserveKey(now);

    if (reserved === null) {
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

    const { keyIndex, logId } = reserved;
    let reportedTokens = 0;

    try {
      return await fn(clientFor(keyIndex), keyIndex, (tokens) => {
        // A bad report must not corrupt the ledger, but the pool stays
        // conservative: only a finite positive cost is added.
        if (Number.isFinite(tokens) && tokens > 0) {
          reportedTokens += tokens;
        }
      });
    } catch (error) {
      if (isRateLimitError(error)) {
        if (isPoolDailyLimitError(error)) {
          // The org's daily token budget is gone. Retiring one key would just
          // move the next request onto an equally spent key, so the pool stops
          // for the reset Groq stated.
          await coolDownPool(cooldownMsFor(error, DEFAULT_POOL_COOLDOWN_MS));
        } else {
          await coolDown(keyIndex, cooldownMsFor(error));
        }
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
    } finally {
      // Recorded for failed attempts too: a completion that came back empty
      // still spent the tokens Groq billed. A 429 spent none, so it reports
      // nothing and writes nothing.
      if (reportedTokens > 0) {
        await recordTokenUsage(logId, reportedTokens);
      }
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
