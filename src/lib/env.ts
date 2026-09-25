/**
 * Splits a comma-separated environment value into trimmed, non-empty entries.
 *
 * Used for both GROQ_API_KEYS and ADMIN_EMAILS. The number of entries is never
 * assumed: the pool works with however many keys are provided (4 during testing,
 * ~15 for the event), so no caller may assume a fixed length.
 */
export function parseList(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Reads a positive integer environment variable, falling back when it is unset
 * or blank. Throws rather than silently defaulting when the value is present but
 * unusable, since a bad rate limit or queue timeout is worse than a failed boot.
 */
export function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Environment variable ${name} must be a positive integer, got "${raw}"`,
    );
  }
  return parsed;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

/**
 * Validated environment. `.env` is loaded natively by Next.js for both
 * `next build` and the server runtime, so no dotenv import is needed here --
 * and it must not be, since dotenv is a devDependency and this module is
 * application code that ships to production.
 */
export const env = {
  databaseUrl: required("DATABASE_URL"),
  /** Auth.js v5 reads AUTH_SECRET. NEXTAUTH_SECRET is the v4 name and is not used. */
  authSecret: required("AUTH_SECRET"),
  groqApiKeys: parseList(required("GROQ_API_KEYS")),
  groqKeyRpd: optionalInt("GROQ_KEY_RPD", 1000),
  groqKeyRpm: optionalInt("GROQ_KEY_RPM", 30),
  /**
   * Tokens per minute per key. The measured free-tier ceiling for
   * openai/gpt-oss-120b is 8000 (`x-ratelimit-limit-tokens`), and reasoning
   * tokens count toward it, so this -- not RPM -- is the real bottleneck.
   */
  groqKeyTpm: optionalInt("GROQ_KEY_TPM", 8000),
  /**
   * The whole pool's shared daily token budget. Groq's `tokens per day (TPD)`
   * limit is enforced per organization, not per key: every key in the pool
   * belongs to the same org (measured: all four report org_01m3be03f0ev1s5mpvq690fe2s)
   * and one 200000-token ceiling covers them all. Adding keys therefore does
   * not add daily token capacity. This is the pool's real ceiling; the per-key
   * numbers above govern the minute and the request budget only.
   */
  groqPoolTpd: optionalInt("GROQ_POOL_TPD", 200_000),
  /** Lowercased so the admin allowlist comparison is case-insensitive. */
  adminEmails: parseList(process.env.ADMIN_EMAILS ?? "").map((email) =>
    email.toLowerCase(),
  ),
  queueMaxWaitMs: optionalInt("GUARDIAN_QUEUE_MAX_WAIT_MS", 12_000),
  queuePollMs: optionalInt("GUARDIAN_QUEUE_POLL_MS", 300),
} as const;

export type Env = typeof env;
