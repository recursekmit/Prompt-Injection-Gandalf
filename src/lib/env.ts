import { parseGuardianLevels } from "@/lib/guardian/config";

/**
 * Splits a comma-separated environment value into trimmed, non-empty entries.
 *
 * Used for ADMIN_EMAILS. The number of entries is never assumed: however many
 * admins are provided, no caller may assume a fixed length.
 */
export function parseList(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

/** Reads a required env var and asserts it base64-decodes to exactly 32 bytes. */
export function requireKeyBase64(name: string): string {
  const value = required(name);
  if (Buffer.from(value, "base64").length !== 32) {
    throw new Error(`Environment variable ${name} must be 32 bytes, base64-encoded`);
  }
  return value;
}

/**
 * Validated environment. `.env` is loaded natively by Next.js for both
 * `next build` and the server runtime, so no dotenv import is needed here --
 * and it must not be, since dotenv is a devDependency and this module is
 * application code that ships to production.
 */
export const env = {
  databaseUrl: required("DATABASE_URL"),
  /** Direct (non-pooled) Postgres URL for prisma migrate. Falls back to DATABASE_URL locally. */
  directUrl: process.env.DIRECT_URL?.trim() || required("DATABASE_URL"),
  authSecret: required("AUTH_SECRET"),
  /** 32-byte base64 key that encrypts each user's stored Groq key. Separate from AUTH_SECRET. */
  keyEncryptionKey: requireKeyBase64("KEY_ENCRYPTION_KEY"),
  adminEmails: parseList(process.env.ADMIN_EMAILS ?? "").map((email) =>
    email.toLowerCase(),
  ),
  /** Per-level persona/seal/word, base64-JSON in GUARDIAN_LEVELS. Kept out of the repo. */
  guardianLevels: parseGuardianLevels(required("GUARDIAN_LEVELS")),
} as const;

export type Env = typeof env;
