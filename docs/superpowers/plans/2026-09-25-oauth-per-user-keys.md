# GitHub OAuth + Per-User Groq Keys + Vercel Deploy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub OAuth beside the existing password login, replace the shared Groq key pool with a per-user encrypted key, and make PromptGuard deployable on Vercel + Neon for 100+ concurrent players.

**Architecture:** Auth stays on Auth.js v5 with JWT sessions; a GitHub provider is added and OAuth users are upserted into the `User` table in the `signIn` callback. Each player supplies their own Groq key, stored AES-256-GCM encrypted on the `User` row and decrypted per guardian call. The shared pool (`groq-key-pool.ts`, three `ApiKey*` tables, `/api/admin/keys`) is deleted. Postgres moves to Neon's pooled endpoint; the attempt route gets `maxDuration = 60`.

**Tech Stack:** Next.js 16 (App Router), Auth.js v5 (next-auth beta), Prisma 7 with `@prisma/adapter-pg`, PostgreSQL 18 (Neon in prod), Node `crypto`, Groq SDK, Vitest.

## Global Constraints

- Node 22+. TypeScript pinned at `7.0.2`; `npm run lint` is intentionally absent — verification is `npm test` + `npm run build`.
- `npm run dev`/`start` run on port **3200**.
- Schema changes go through `prisma migrate dev`, never `prisma db push`. After migrate, run `npx prisma generate` and (if seed data needed) `npx prisma db seed` — Prisma 7 does neither automatically.
- The partial unique index `game_session_one_active_per_user` is hand-maintained; never drop it.
- Model `reasoning` is never read, logged, returned, or stored — only `content` leaves the guardian call site.
- Decrypted Groq keys are never logged and never returned to the client.
- The guardian system prompt is always rebuilt from the trusted constant, never from stored/conversation-influenced text.
- Auth.js v5 reads `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` by those exact names.
- Commit after every task with a green `npm test`.

## Task overview

1. AES-256-GCM secret box (`secret-box.ts`)
2. Env changes: add `KEY_ENCRYPTION_KEY`/`DIRECT_URL`, remove all `GROQ_*` + queue vars
3. Prisma schema + migration: `passwordHash` optional, add `groqKeyEnc`, drop `ApiKey*` tables
4. Rewrite `callGuardian` to take a key; delete the pool
5. Per-user key service (get/set/clear + validate against Groq)
6. `/api/account/groq-key` route (GET status, POST set, DELETE clear)
7. Auth: add GitHub provider + `signIn` upsert + passwordless guard
8. Wire the attempt route to the caller's key + `maxDuration`
9. Onboarding gate + login GitHub button
10. Prune the admin keys route + nav
11. Neon + Vercel deploy config

---
### Task 1: AES-256-GCM secret box

**Files:**
- Create: `src/lib/crypto/secret-box.ts`
- Test: `src/lib/crypto/secret-box.test.ts`

**Interfaces:**
- Consumes: nothing (Node `crypto` only).
- Produces: `encryptSecret(plaintext: string, keyBase64: string): string` and `decryptSecret(payload: string, keyBase64: string): string`. Payload format is `iv:authTag:ciphertext`, each segment base64. `decryptSecret` throws on a tampered/short payload or wrong key. Key must decode to exactly 32 bytes or both throw `Error("KEY_ENCRYPTION_KEY must decode to 32 bytes")`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secret-box";

// A valid 32-byte key, base64.
const KEY = Buffer.alloc(32, 7).toString("base64");

describe("secret-box", () => {
  it("round-trips a value", () => {
    const box = encryptSecret("gsk_secret_value", KEY);
    expect(box).not.toContain("gsk_secret_value");
    expect(decryptSecret(box, KEY)).toBe("gsk_secret_value");
  });

  it("produces a fresh iv each call", () => {
    expect(encryptSecret("x", KEY)).not.toBe(encryptSecret("x", KEY));
  });

  it("rejects a tampered ciphertext", () => {
    const [iv, tag, data] = encryptSecret("x", KEY).split(":");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 0xff;
    const bad = [iv, tag, flipped.toString("base64")].join(":");
    expect(() => decryptSecret(bad, KEY)).toThrow();
  });

  it("rejects a wrong-length key", () => {
    expect(() => encryptSecret("x", Buffer.alloc(16).toString("base64"))).toThrow(
      "KEY_ENCRYPTION_KEY must decode to 32 bytes",
    );
  });

  it("rejects a malformed payload", () => {
    expect(() => decryptSecret("nope", KEY)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/crypto/secret-box.test.ts`
Expected: FAIL — module `secret-box` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM authenticated encryption for a single short secret (a Groq key).
 * Payload is `iv:authTag:ciphertext`, each base64. GCM's auth tag is what makes
 * a tampered payload throw on decrypt rather than returning garbage.
 */
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM's standard nonce length.
const KEY_BYTES = 32;

function keyFrom(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error("KEY_ENCRYPTION_KEY must decode to 32 bytes");
  }
  return key;
}

export function encryptSecret(plaintext: string, keyBase64: string): string {
  const key = keyFrom(keyBase64);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(payload: string, keyBase64: string): string {
  const key = keyFrom(keyBase64);
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed secret payload");
  }
  const [iv, authTag, ciphertext] = parts.map((part) => Buffer.from(part, "base64"));
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/crypto/secret-box.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/crypto/secret-box.ts src/lib/crypto/secret-box.test.ts
git commit -m "feat(crypto): AES-256-GCM secret box for per-user keys"
```

---
### Task 2: Env changes

**Files:**
- Modify: `src/lib/env.ts`
- Modify: `src/lib/env.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `env.keyEncryptionKey: string` (validated 32-byte base64) and `env.directUrl: string`. Removes `env.groqApiKeys`, `env.groqKeyRpd`, `env.groqKeyRpm`, `env.groqKeyTpm`, `env.groqPoolTpd`, `env.queueMaxWaitMs`, `env.queuePollMs`. `env.databaseUrl`, `env.authSecret`, `env.adminEmails` unchanged.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/env.test.ts` (keep existing `parseList`/`optionalInt` tests):

```ts
import { describe, expect, it } from "vitest";
import { requireKeyBase64 } from "@/lib/env";

describe("requireKeyBase64", () => {
  it("returns the value when it decodes to 32 bytes", () => {
    const key = Buffer.alloc(32, 1).toString("base64");
    process.env.KEY_ENCRYPTION_KEY = key;
    expect(requireKeyBase64("KEY_ENCRYPTION_KEY")).toBe(key);
  });

  it("throws when it is not 32 bytes", () => {
    process.env.KEY_ENCRYPTION_KEY = Buffer.alloc(16).toString("base64");
    expect(() => requireKeyBase64("KEY_ENCRYPTION_KEY")).toThrow("32 bytes");
  });

  it("throws when it is missing", () => {
    delete process.env.KEY_ENCRYPTION_KEY;
    expect(() => requireKeyBase64("KEY_ENCRYPTION_KEY")).toThrow("Missing");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/env.test.ts`
Expected: FAIL — `requireKeyBase64` not exported.

- [ ] **Step 3: Edit `src/lib/env.ts`**

Add this helper below `required`:

```ts
/** Reads a required env var and asserts it base64-decodes to exactly 32 bytes. */
export function requireKeyBase64(name: string): string {
  const value = required(name);
  if (Buffer.from(value, "base64").length !== 32) {
    throw new Error(`Environment variable ${name} must be 32 bytes, base64-encoded`);
  }
  return value;
}
```

Replace the `env` object with (drops every `groq*`/`queue*` field, adds the two new ones):

```ts
export const env = {
  databaseUrl: required("DATABASE_URL"),
  /** Direct (non-pooled) Postgres URL for prisma migrate. Falls back to DATABASE_URL locally. */
  directUrl: process.env.DIRECT_URL?.trim() || required("DATABASE_URL"),
  authSecret: required("AUTH_SECRET"),
  /** 32-byte base64 key that encrypts each user's stored Groq key. Separate from AUTH_SECRET. */
  keyEncryptionKey: requireKeyBase64("KEY_ENCRYPTION_KEY"),
  adminEmails: parseList(process.env.ADMIN_EMAILS ?? "").map((email) => email.toLowerCase()),
} as const;
```

Delete `parseList`'s now-stale doc reference to GROQ_API_KEYS (leave the function; it still serves ADMIN_EMAILS). Leave `optionalInt` in place only if still referenced; if nothing references it after this edit, delete it and its tests.

- [ ] **Step 4: Rewrite `.env.example`**

```bash
# --- Database ---------------------------------------------------------------
# App uses the POOLED Neon URL; migrations use the DIRECT one.
DATABASE_URL="postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/db?sslmode=require"
DIRECT_URL="postgresql://user:pass@ep-xxx.region.aws.neon.tech/db?sslmode=require"

# --- Auth -------------------------------------------------------------------
# Generate with: npx auth secret
AUTH_SECRET="replace-me"
# GitHub OAuth app credentials (Auth.js v5 reads these names).
AUTH_GITHUB_ID="replace-me"
AUTH_GITHUB_SECRET="replace-me"

# --- Encryption -------------------------------------------------------------
# 32 random bytes, base64. Generate with: openssl rand -base64 32
# Encrypts each user's stored Groq key. Lose this and stored keys are unrecoverable.
KEY_ENCRYPTION_KEY="replace-me"

# --- Admin ------------------------------------------------------------------
ADMIN_EMAILS="you@example.com"
```

- [ ] **Step 5: Run test + build**

Run: `npx vitest run src/lib/env.test.ts`
Expected: PASS. (`npm run build` will fail until Task 4 removes pool references — that is expected mid-plan.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/env.ts src/lib/env.test.ts .env.example
git commit -m "feat(env): add KEY_ENCRYPTION_KEY and DIRECT_URL, drop pool vars"
```

---
### Task 3: Schema + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_oauth_and_per_user_keys/migration.sql` (generated)

**Interfaces:**
- Produces: `User.passwordHash String?`, `User.groqKeyEnc String?`. Removes models `ApiKeyDailyUsage`, `ApiKeyRequestLog`, `ApiKeyCooldown` (and their tables).

- [ ] **Step 1: Edit `prisma/schema.prisma`**

Change the `User` model to:

```prisma
model User {
  id           String        @id @default(cuid())
  email        String        @unique
  /// Null for OAuth-only accounts (GitHub). The Credentials path guards against null.
  passwordHash String?
  /// Per-user Groq key, AES-256-GCM encrypted as `iv:authTag:ciphertext`. Null until the user adds one.
  groqKeyEnc   String?
  createdAt    DateTime      @default(now())
  sessions     GameSession[]
}
```

Delete the three `ApiKey*` models (`ApiKeyDailyUsage`, `ApiKeyRequestLog`, `ApiKeyCooldown`) entirely.

- [ ] **Step 2: Create the migration**

Run: `npx prisma migrate dev --name oauth_and_per_user_keys`
Expected: creates and applies the migration; the generated SQL alters `User` (drop NOT NULL on `passwordHash`, add `groqKeyEnc`) and drops the three `ApiKey*` tables.

- [ ] **Step 3: Regenerate the client**

Run: `npx prisma generate`
Expected: `Generated Prisma Client` — `User` now has optional `passwordHash`/`groqKeyEnc`; the `apiKey*` model accessors are gone.

- [ ] **Step 4: Verify the partial index survived**

Run: `git diff prisma/migrations` and confirm no migration drops `game_session_one_active_per_user`. If Prisma emitted a drop, remove that statement before it is applied.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): optional passwordHash, add groqKeyEnc, drop pool tables"
```

---
### Task 4: Rewrite `callGuardian` to take a key; delete the pool

**Files:**
- Modify: `src/lib/guardian/call.ts`
- Modify: `src/lib/guardian/call.test.ts`
- Delete: `src/lib/groq-key-pool.ts`, `src/lib/groq-key-pool.test.ts`, `src/lib/groq-key-pool.exhaustion.test.ts`

**Interfaces:**
- Consumes: nothing new (constructs `new Groq({ apiKey })` directly).
- Produces: `callGuardian(messages, effort, apiKey: string): Promise<string>`. Throws `GuardianKeyRateLimitError` on the caller-key 429, `GuardianUnavailableError` on everything else. `GuardianBusyError` no longer exists.

- [ ] **Step 1: Rewrite `src/lib/guardian/call.ts`**

```ts
import Groq from "groq-sdk";
import type { ReasoningEffort } from "@/lib/guardian/levels";

const GUARDIAN_MODEL = "openai/gpt-oss-120b";

/** The caller's own Groq key hit its rate limit. Mapped to a friendly 503 with a distinct message. */
export class GuardianKeyRateLimitError extends Error {
  readonly retryable = false;
  constructor(message = "Your Groq key is rate-limited. Wait a moment and try again.") {
    super(message);
    this.name = "GuardianKeyRateLimitError";
  }
}

/** Generic guardian failure. Never carries raw Groq text. */
export class GuardianUnavailableError extends Error {
  readonly retryable = false;
  constructor(message = "The guardian is unavailable right now. Try again shortly.") {
    super(message);
    this.name = "GuardianUnavailableError";
  }
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

/**
 * Sends the prompt history to the guardian on the caller's own key and returns
 * its reply. Non-streaming on purpose: the reply is scanned for the secret word
 * before any of it reaches the client. Reads `content` only — the `reasoning`
 * field can contain the word and is never touched.
 */
export async function callGuardian(
  messages: ReadonlyArray<{ role: "user" | "assistant" | "system"; content: string }>,
  effort: ReasoningEffort,
  apiKey: string,
): Promise<string> {
  try {
    const client = new Groq({ apiKey });
    const completion = await client.chat.completions.create({
      model: GUARDIAN_MODEL,
      messages: [...messages],
      reasoning_effort: effort,
      stream: false,
    });
    const { content } = completion.choices[0]?.message ?? {};
    if (typeof content !== "string" || content.length === 0) {
      throw new GuardianUnavailableError();
    }
    return content;
  } catch (error) {
    if (error instanceof GuardianUnavailableError) throw error;
    if (statusOf(error) === 429) throw new GuardianKeyRateLimitError();
    throw new GuardianUnavailableError();
  }
}
```

- [ ] **Step 2: Delete the pool files**

```bash
git rm src/lib/groq-key-pool.ts src/lib/groq-key-pool.test.ts src/lib/groq-key-pool.exhaustion.test.ts
```

- [ ] **Step 3: Rewrite `src/lib/guardian/call.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("groq-sdk", () => ({
  default: class {
    chat = { completions: { create } };
    constructor(public opts: { apiKey: string }) {}
  },
}));

import { callGuardian, GuardianKeyRateLimitError, GuardianUnavailableError } from "@/lib/guardian/call";

describe("callGuardian", () => {
  it("returns content and never reads reasoning", async () => {
    create.mockResolvedValueOnce({ choices: [{ message: { content: "hi", reasoning: "SECRET" } }] });
    await expect(callGuardian([{ role: "user", content: "x" }], "low", "gsk_test")).resolves.toBe("hi");
  });

  it("throws GuardianUnavailableError on empty content", async () => {
    create.mockResolvedValueOnce({ choices: [{ message: { content: "" } }] });
    await expect(callGuardian([], "low", "gsk_test")).rejects.toBeInstanceOf(GuardianUnavailableError);
  });

  it("maps a 429 to GuardianKeyRateLimitError", async () => {
    create.mockRejectedValueOnce({ status: 429 });
    await expect(callGuardian([], "low", "gsk_test")).rejects.toBeInstanceOf(GuardianKeyRateLimitError);
  });
});
```

- [ ] **Step 4: Run the guardian tests**

Run: `npx vitest run src/lib/guardian/call.test.ts`
Expected: PASS (3 tests). (`npm test` overall still fails: the attempt route imports the old symbols — fixed in Task 8.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/guardian/call.ts src/lib/guardian/call.test.ts
git commit -m "feat(guardian): call on the caller's own key; remove the shared pool"
```

---
### Task 5: Per-user key service

**Files:**
- Create: `src/lib/account/groq-key.ts`
- Test: `src/lib/account/groq-key.test.ts`

**Interfaces:**
- Consumes: `encryptSecret`/`decryptSecret` (Task 1), `env.keyEncryptionKey` (Task 2), `prisma` (`User.groqKeyEnc`).
- Produces:
  - `validateGroqKey(apiKey: string): Promise<boolean>` — true if Groq accepts the key (a `models.list()` call succeeds).
  - `storeGroqKey(userId: string, apiKey: string): Promise<void>` — encrypts and writes `groqKeyEnc`.
  - `clearGroqKey(userId: string): Promise<void>` — sets `groqKeyEnc = null`.
  - `getGroqKey(userId: string): Promise<string | null>` — decrypts and returns the key, or null if none.
  - `hasGroqKey(userId: string): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const list = vi.fn();
vi.mock("groq-sdk", () => ({
  default: class {
    models = { list };
    constructor(public opts: { apiKey: string }) {}
  },
}));

const findUnique = vi.fn();
const update = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique, update } } }));
vi.mock("@/lib/env", () => ({ env: { keyEncryptionKey: Buffer.alloc(32, 9).toString("base64") } }));

import { validateGroqKey, storeGroqKey, getGroqKey, hasGroqKey, clearGroqKey } from "@/lib/account/groq-key";
import { encryptSecret } from "@/lib/crypto/secret-box";

const KEY = Buffer.alloc(32, 9).toString("base64");

describe("groq-key service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("validateGroqKey is true when Groq accepts the key", async () => {
    list.mockResolvedValueOnce({ data: [] });
    await expect(validateGroqKey("gsk_ok")).resolves.toBe(true);
  });

  it("validateGroqKey is false when Groq rejects the key", async () => {
    list.mockRejectedValueOnce({ status: 401 });
    await expect(validateGroqKey("gsk_bad")).resolves.toBe(false);
  });

  it("storeGroqKey writes an encrypted value, not the plaintext", async () => {
    await storeGroqKey("u1", "gsk_plain");
    const written = update.mock.calls[0][0].data.groqKeyEnc as string;
    expect(written).not.toContain("gsk_plain");
    expect(written.split(":")).toHaveLength(3);
  });

  it("getGroqKey decrypts a stored value", async () => {
    findUnique.mockResolvedValueOnce({ groqKeyEnc: encryptSecret("gsk_plain", KEY) });
    await expect(getGroqKey("u1")).resolves.toBe("gsk_plain");
  });

  it("getGroqKey returns null when none stored", async () => {
    findUnique.mockResolvedValueOnce({ groqKeyEnc: null });
    await expect(getGroqKey("u1")).resolves.toBeNull();
  });

  it("hasGroqKey reflects presence", async () => {
    findUnique.mockResolvedValueOnce({ groqKeyEnc: encryptSecret("x", KEY) });
    await expect(hasGroqKey("u1")).resolves.toBe(true);
  });

  it("clearGroqKey nulls the column", async () => {
    await clearGroqKey("u1");
    expect(update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { groqKeyEnc: null } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/account/groq-key.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/account/groq-key.ts`**

```ts
import Groq from "groq-sdk";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

/**
 * Checks a key with Groq itself: a `models.list()` call is cheap (no tokens
 * spent) and 401s on a bad key, which is exactly the yes/no we need. Any error
 * means "do not accept it".
 */
export async function validateGroqKey(apiKey: string): Promise<boolean> {
  try {
    await new Groq({ apiKey }).models.list();
    return true;
  } catch {
    return false;
  }
}

export async function storeGroqKey(userId: string, apiKey: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { groqKeyEnc: encryptSecret(apiKey, env.keyEncryptionKey) },
  });
}

export async function clearGroqKey(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { groqKeyEnc: null } });
}

export async function getGroqKey(userId: string): Promise<string | null> {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { groqKeyEnc: true } });
  if (row?.groqKeyEnc == null) return null;
  return decryptSecret(row.groqKeyEnc, env.keyEncryptionKey);
}

export async function hasGroqKey(userId: string): Promise<boolean> {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { groqKeyEnc: true } });
  return row?.groqKeyEnc != null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/account/groq-key.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/account/groq-key.ts src/lib/account/groq-key.test.ts
git commit -m "feat(account): per-user Groq key store with validation"
```

---
### Task 6: `/api/account/groq-key` route

**Files:**
- Create: `src/app/api/account/groq-key/route.ts`
- Test: `src/app/api/account/groq-key/route.test.ts`

**Interfaces:**
- Consumes: `auth` (session), `validateGroqKey`/`storeGroqKey`/`clearGroqKey`/`hasGroqKey` (Task 5).
- Produces: `GET` → `{ hasKey: boolean }`; `POST {apiKey}` → 200 `{ hasKey: true }` on a valid key, 400 on missing/invalid, 401 unauthenticated; `DELETE` → 200 `{ hasKey: false }`. The stored key is never returned by any method.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth }));
const validateGroqKey = vi.fn();
const storeGroqKey = vi.fn();
const clearGroqKey = vi.fn();
const hasGroqKey = vi.fn();
vi.mock("@/lib/account/groq-key", () => ({ validateGroqKey, storeGroqKey, clearGroqKey, hasGroqKey }));

import { GET, POST, DELETE } from "@/app/api/account/groq-key/route";

function post(body: unknown): Request {
  return new Request("http://x/api/account/groq-key", { method: "POST", body: JSON.stringify(body) });
}

describe("groq-key route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "u1" } });
  });

  it("401s when not signed in", async () => {
    auth.mockResolvedValueOnce(null);
    expect((await POST(post({ apiKey: "gsk_x" }))).status).toBe(401);
  });

  it("400s an invalid key and does not store it", async () => {
    validateGroqKey.mockResolvedValueOnce(false);
    expect((await POST(post({ apiKey: "gsk_bad" }))).status).toBe(400);
    expect(storeGroqKey).not.toHaveBeenCalled();
  });

  it("stores a valid key", async () => {
    validateGroqKey.mockResolvedValueOnce(true);
    const res = await POST(post({ apiKey: "gsk_ok" }));
    expect(res.status).toBe(200);
    expect(storeGroqKey).toHaveBeenCalledWith("u1", "gsk_ok");
    expect(await res.json()).toEqual({ hasKey: true });
  });

  it("GET reports presence", async () => {
    hasGroqKey.mockResolvedValueOnce(true);
    expect(await (await GET()).json()).toEqual({ hasKey: true });
  });

  it("DELETE clears the key", async () => {
    const res = await DELETE();
    expect(clearGroqKey).toHaveBeenCalledWith("u1");
    expect(await res.json()).toEqual({ hasKey: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/account/groq-key/route.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 3: Write `src/app/api/account/groq-key/route.ts`**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { clearGroqKey, hasGroqKey, storeGroqKey, validateGroqKey } from "@/lib/account/groq-key";

export async function GET(): Promise<Response> {
  const session = await auth();
  if (session === null) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({ hasKey: await hasGroqKey(session.user.id) });
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (session === null) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const apiKey = (body as { apiKey?: unknown } | null)?.apiKey;
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    return NextResponse.json({ error: "A Groq API key is required." }, { status: 400 });
  }
  if (!(await validateGroqKey(apiKey.trim()))) {
    return NextResponse.json({ error: "Groq rejected that key." }, { status: 400 });
  }
  await storeGroqKey(session.user.id, apiKey.trim());
  return NextResponse.json({ hasKey: true });
}

export async function DELETE(): Promise<Response> {
  const session = await auth();
  if (session === null) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  await clearGroqKey(session.user.id);
  return NextResponse.json({ hasKey: false });
}

export const dynamic = "force-dynamic";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/account/groq-key/route.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/account/groq-key
git commit -m "feat(account): groq-key API route (get/set/clear)"
```

---
### Task 7: Auth — add GitHub provider

**Files:**
- Create: `src/lib/auth/oauth.ts`
- Test: `src/lib/auth/oauth.test.ts`
- Modify: `src/lib/auth.ts`

**Interfaces:**
- Consumes: `prisma`.
- Produces: `upsertGithubUser(email: string): Promise<string>` — upserts a `User` by email and returns its DB id. `src/lib/auth.ts` gains the GitHub provider and OAuth-aware `signIn`/`jwt` callbacks; the Credentials path rejects accounts with a null `passwordHash`.

- [ ] **Step 1: Write the failing test for the helper**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { user: { upsert } } }));

import { upsertGithubUser } from "@/lib/auth/oauth";

describe("upsertGithubUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("upserts by email and returns the db id", async () => {
    upsert.mockResolvedValueOnce({ id: "db-1" });
    await expect(upsertGithubUser("a@b.com")).resolves.toBe("db-1");
    expect(upsert).toHaveBeenCalledWith({
      where: { email: "a@b.com" },
      update: {},
      create: { email: "a@b.com" },
      select: { id: true },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth/oauth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/auth/oauth.ts`**

```ts
import { prisma } from "@/lib/prisma";

/**
 * Ensures a User row exists for a GitHub sign-in and returns its DB id. The
 * email is the join key: a player who signed up with a password and later uses
 * GitHub with the same verified email lands on the same account.
 */
export async function upsertGithubUser(email: string): Promise<string> {
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
    select: { id: true },
  });
  return user.id;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/auth/oauth.test.ts`
Expected: PASS.

- [ ] **Step 5: Edit `src/lib/auth.ts`**

Add imports:

```ts
import GitHub from "next-auth/providers/github";
import { upsertGithubUser } from "@/lib/auth/oauth";
```

Add `GitHub` to the `providers` array (after `Credentials(...)`). It auto-reads `AUTH_GITHUB_ID`/`AUTH_GITHUB_SECRET`:

```ts
    GitHub({ authorization: { params: { scope: "read:user user:email" } } }),
```

In the Credentials `authorize`, guard the null hash (OAuth-only accounts have no password). After the `user === null` check, add:

```ts
        if (user.passwordHash === null) {
          // OAuth-only account: no password to verify against.
          return null;
        }
```

Replace the `callbacks` object with:

```ts
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "github") {
        if (typeof user.email !== "string") return false; // no verified email, refuse.
        await upsertGithubUser(user.email);
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (account?.provider === "github" && typeof token.email === "string") {
        token.id = await upsertGithubUser(token.email);
      } else if (user?.id !== undefined) {
        token.id = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.id === "string") {
        session.user.id = token.id;
      }
      return session;
    },
  },
```

- [ ] **Step 6: Build to verify wiring**

Run: `npm run build`
Expected: build succeeds (the attempt route is fixed in Task 8; if you run this before Task 8 it will fail on `groq-key-pool` imports — do Task 8 first if so, or accept the known failure and re-run after Task 8).

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/oauth.ts src/lib/auth/oauth.test.ts src/lib/auth.ts
git commit -m "feat(auth): add GitHub OAuth with user upsert; guard passwordless login"
```

---
### Task 8: Wire the attempt route to the caller's key

**Files:**
- Modify: `src/app/api/session/[id]/attempt/route.ts`
- Modify: `src/app/api/session/[id]/attempt/route.test.ts`

**Interfaces:**
- Consumes: `getGroqKey` (Task 5), `callGuardian(messages, effort, apiKey)` + `GuardianKeyRateLimitError`/`GuardianUnavailableError` (Task 4).

- [ ] **Step 1: Edit the imports in `route.ts`**

Replace the guardian/pool imports with:

```ts
import { getGroqKey } from "@/lib/account/groq-key";
import {
  GuardianKeyRateLimitError,
  GuardianUnavailableError,
  callGuardian,
} from "@/lib/guardian/call";
```

Delete the `import { GuardianBusyError } from "@/lib/groq-key-pool";` line.

- [ ] **Step 2: Fetch the caller's key before calling the guardian**

Immediately before the `const systemPrompt = ...` line, add:

```ts
  const apiKey = await getGroqKey(session.user.id);
  if (apiKey === null) {
    return NextResponse.json(
      { error: "Add your Groq API key in settings before playing." },
      { status: 400 },
    );
  }
```

- [ ] **Step 3: Pass the key and update the catch**

Change the call to:

```ts
    reply = await callGuardian(messages, levelFor(level).effort, apiKey);
```

Replace the catch body's error mapping with:

```ts
    if (error instanceof GuardianKeyRateLimitError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof GuardianUnavailableError) {
      return NextResponse.json({ error: GUARDIAN_OVERWHELMED }, { status: 503 });
    }
    console.error("guardian call failed", error);
    return NextResponse.json({ error: GUARDIAN_OVERWHELMED }, { status: 503 });
```

(Delete the `GuardianBusyError` branch.)

- [ ] **Step 4: Add `maxDuration`**

Change the trailing export to:

```ts
export const dynamic = "force-dynamic";
// The guardian call runs ~14s p50; 60s is the Vercel Hobby ceiling and leaves margin.
export const maxDuration = 60;
```

- [ ] **Step 5: Fix the route test**

In `src/app/api/session/[id]/attempt/route.test.ts`, replace any `groq-key-pool` mock with a `getGroqKey` mock and update the `callGuardian` mock to the 3-arg signature. Add these mocks near the top:

```ts
vi.mock("@/lib/account/groq-key", () => ({ getGroqKey: vi.fn().mockResolvedValue("gsk_test") }));
```

Add one test: with `getGroqKey` returning `null`, POST returns 400 and never calls `callGuardian`. Update existing guardian-failure assertions to construct `new GuardianUnavailableError()` / `new GuardianKeyRateLimitError()` instead of `GuardianBusyError`.

- [ ] **Step 6: Run the route test + full suite**

Run: `npx vitest run src/app/api/session` then `npm test`
Expected: PASS. `npm test` is now green end to end.

- [ ] **Step 7: Commit**

```bash
git add "src/app/api/session/[id]/attempt/route.ts" "src/app/api/session/[id]/attempt/route.test.ts"
git commit -m "feat(game): guardian runs on the player's own key"
```

---
### Task 9: Onboarding gate + login GitHub button

**Files:**
- Create: `src/components/groq-key-form.tsx`
- Create: `src/app/settings/key/page.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/(auth)/login/page.tsx`

**Interfaces:**
- Consumes: `hasGroqKey` (Task 5), the `/api/account/groq-key` route (Task 6), `signIn` from `next-auth/react`.

- [ ] **Step 1: Create `src/components/groq-key-form.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/**
 * Add / replace / remove the player's Groq key. Write-only: the key is never
 * fetched back, `hasKey` is all the client is told.
 */
export function GroqKeyForm({ hasKey }: { hasKey: boolean }): React.JSX.Element {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/account/groq-key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not save that key.");
        return;
      }
      setApiKey("");
      router.push("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await fetch("/api/account/groq-key", { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm text-stone-300">
        {hasKey ? "Replace your Groq API key" : "Your Groq API key"}
        <input
          type="password"
          name="apiKey"
          autoComplete="off"
          required
          placeholder="gsk_…"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-stone-100 outline-none focus:border-amber-500"
        />
      </label>
      {error !== null && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-amber-500 px-4 py-2 font-medium text-stone-950 hover:bg-amber-400 disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save key"}
        </button>
        {hasKey && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="rounded-lg border border-stone-700 px-4 py-2 text-stone-300 hover:border-stone-500 disabled:opacity-60"
          >
            Remove
          </button>
        )}
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Create `src/app/settings/key/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import type * as React from "react";
import { GroqKeyForm } from "@/components/groq-key-form";
import { SiteHeader } from "@/components/site-header";
import { hasGroqKey } from "@/lib/account/groq-key";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function KeySettingsPage(): Promise<React.JSX.Element> {
  const session = await auth();
  if (session === null) redirect("/login");

  const keyPresent = await hasGroqKey(session.user.id);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-lg px-6 py-12">
        <h1 className="font-display text-2xl font-semibold text-stone-100">Your Groq key</h1>
        <p className="mt-2 mb-6 text-sm text-stone-400">
          PromptGuard runs the guardian on your own Groq key. Get one free at{" "}
          <a href="https://console.groq.com/keys" className="text-amber-400 hover:text-amber-300">
            console.groq.com/keys
          </a>
          . It is stored encrypted and never shown again.
        </p>
        <GroqKeyForm hasKey={keyPresent} />
      </main>
    </>
  );
}
```

- [ ] **Step 3: Gate the game in `src/app/page.tsx`**

Add the import and, right after the `if (session === null) redirect("/login");` block, gate on the key:

```tsx
import { hasGroqKey } from "@/lib/account/groq-key";
```

```tsx
  if (!(await hasGroqKey(session.user.id))) {
    redirect("/settings/key");
  }
```

- [ ] **Step 4: Add a GitHub button to `src/app/(auth)/login/page.tsx`**

Add `import { signIn } from "next-auth/react";` is already present. Add a button below the closing `</form>`, before the "Need an account?" paragraph:

```tsx
      <button
        type="button"
        onClick={() => signIn("github", { callbackUrl: "/" })}
        className="rounded-lg border border-stone-700 px-4 py-2 font-medium text-stone-100 hover:border-stone-500"
      >
        Continue with GitHub
      </button>
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Manual smoke (local)**

Requires `AUTH_GITHUB_ID`/`AUTH_GITHUB_SECRET` + `KEY_ENCRYPTION_KEY` in `.env` (see Task 11 / walkthrough). Run `npm run dev`, log in with GitHub, confirm redirect to `/settings/key`, paste a key, confirm you land on the level select and can send one message.

- [ ] **Step 7: Commit**

```bash
git add src/components/groq-key-form.tsx src/app/settings/key/page.tsx src/app/page.tsx "src/app/(auth)/login/page.tsx"
git commit -m "feat(ui): GitHub login button and Groq-key onboarding gate"
```

---
### Task 10: Prune the admin keys route + nav

**Files:**
- Delete: `src/app/api/admin/keys/route.ts` (and the `keys` dir; also `src/app/admin/keys/` if a page exists)
- Modify: `src/components/admin-nav.tsx`
- Modify: `src/components/admin-nav.test.ts`

- [ ] **Step 1: Delete the keys route (and any keys page)**

```bash
git rm src/app/api/admin/keys/route.ts
# If a page dir exists, remove it too:
git rm -r src/app/admin/keys 2>/dev/null || true
```

- [ ] **Step 2: Remove the Keys destination in `src/components/admin-nav.tsx`**

Change `ADMIN_DESTINATIONS` to drop the last entry:

```ts
export const ADMIN_DESTINATIONS: readonly Destination[] = [
  { href: "/admin", label: "Stats" },
  { href: "/admin/leaderboard", label: "Leaderboard" },
  { href: "/admin/users", label: "Users" },
];
```

- [ ] **Step 3: Update `src/components/admin-nav.test.ts`**

Change any assertion that expects a `/admin/keys` / "Keys" entry to expect the three remaining destinations. If a test asserts `ADMIN_DESTINATIONS.length`, set it to `3`; if it references `isCurrent(..., "/admin/keys")`, drop that case.

- [ ] **Step 4: Run tests + build**

Run: `npm test && npm run build`
Expected: PASS and a clean build. Grep to confirm no dangling references: `grep -rn "groq-key-pool\|describePool\|GROQ_API_KEYS\|admin/keys" src` returns nothing.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(admin): remove the key-pool dashboard and nav entry"
```

---
### Task 11: Neon + Vercel deploy config

**Files:**
- Modify: `prisma.config.ts`
- Modify: `src/lib/prisma.ts`
- Modify: `.env` (local), Vercel project env (prod)
- Modify: `README.md` (Setup section)

**Interfaces:**
- Migrations run against `DIRECT_URL`; the app runtime uses the pooled `DATABASE_URL` via the adapter.

- [ ] **Step 1: Point migrations at the direct URL — `prisma.config.ts`**

Change the datasource block to:

```ts
  datasource: {
    url: env("DIRECT_URL"),
  },
```

(Migrations must use the direct, non-pooled endpoint; PgBouncer transaction mode cannot run migrations.)

- [ ] **Step 2: Keep the app on the pooled URL with a small local pool — `src/lib/prisma.ts`**

Change `createClient` to cap connections (pooling is done by Neon's pooler, so the app needs only a few):

```ts
function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.databaseUrl, max: 5 });
  return new PrismaClient({ adapter });
}
```

- [ ] **Step 3: Local env**

Add `DIRECT_URL` to local `.env` equal to `DATABASE_URL` (the local Docker Postgres has no separate pooler), and add `KEY_ENCRYPTION_KEY`:

```bash
# in .env — DIRECT_URL mirrors your existing local DATABASE_URL verbatim
DIRECT_URL="<same value as your local DATABASE_URL>"
KEY_ENCRYPTION_KEY="$(openssl rand -base64 32)"   # paste the generated value literally
```

Run `npm test && npm run build` to confirm the app still boots against local Postgres.

- [ ] **Step 4: Provision Neon (prod)**

Create a Neon project (free tier). From the dashboard copy two connection strings:
- Pooled (host contains `-pooler`) → Vercel env `DATABASE_URL`.
- Direct (no `-pooler`) → Vercel env `DIRECT_URL`.
Both need `?sslmode=require`.

- [ ] **Step 5: Migrate Neon**

Locally, with `DIRECT_URL` temporarily set to the Neon direct string:

```bash
npx prisma migrate deploy   # applies existing migrations to Neon, no shadow db
npx prisma generate
npx prisma db seed          # seeds the six level words
```

- [ ] **Step 6: Set Vercel env vars**

In the Vercel project → Settings → Environment Variables, add: `DATABASE_URL` (pooled), `DIRECT_URL` (direct), `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `KEY_ENCRYPTION_KEY`, `ADMIN_EMAILS`. In Settings → Functions, enable **Fluid compute**.

- [ ] **Step 7: Update `README.md`**

Replace the `GROQ_API_KEYS`/pool paragraphs in the Setup and Rate-limits sections with: each player supplies their own Groq key at `/settings/key` (stored encrypted); document `KEY_ENCRYPTION_KEY`, `DIRECT_URL`, `AUTH_GITHUB_ID`/`AUTH_GITHUB_SECRET`; note the app uses the pooled Neon URL and migrations use the direct one. Remove the load-test/pool section (no pool to load-test).

- [ ] **Step 8: Deploy + smoke**

Push the branch, open a Vercel preview, sign in with GitHub (prod OAuth app), add a key, play one message. Confirm the friendly 503 path by removing the key and sending a message (expect the "add your key" 400).

- [ ] **Step 9: Commit**

```bash
git add prisma.config.ts src/lib/prisma.ts README.md
git commit -m "chore(deploy): Neon pooled runtime + direct migrations, Vercel config"
```

---
## GitHub OAuth app setup (manual, referenced by Tasks 7/9/11)

Classic OAuth apps allow one callback URL each, so create two:

**Local app**
1. github.com → Settings → Developer settings → OAuth Apps → **New OAuth App**.
2. Application name: `PromptGuard (local)`. Homepage URL: `http://localhost:3200`.
3. Authorization callback URL: `http://localhost:3200/api/auth/callback/github`.
4. Register, then **Generate a new client secret**.
5. Put the Client ID → `AUTH_GITHUB_ID` and secret → `AUTH_GITHUB_SECRET` in local `.env`.

**Prod app**
1. Repeat with name `PromptGuard`, Homepage `https://<your-vercel-domain>`, callback `https://<your-vercel-domain>/api/auth/callback/github`.
2. Client ID/secret → Vercel env `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`.

---
## Self-review

- **Spec coverage:** GitHub OAuth (T7, T9), keep both auth methods (T7 guard + T9 button), per-user encrypted key (T1/T3/T5), enter once + onboarding (T6/T9), remove pool + tables + admin keys + env (T2/T4/T10), Neon pooled + direct + maxDuration + Fluid (T8/T11), OAuth walkthrough (dedicated section), testing (each task). All spec sections map to a task.
- **Type consistency:** `callGuardian(messages, effort, apiKey)` used identically in T4/T8; `hasGroqKey`/`getGroqKey`/`storeGroqKey`/`clearGroqKey`/`validateGroqKey` names consistent across T5/T6/T8/T9; `upsertGithubUser` T7 only; `encryptSecret`/`decryptSecret` T1/T5; `GuardianKeyRateLimitError`/`GuardianUnavailableError` T4/T8 (old `GuardianBusyError` removed everywhere).
- **Placeholder scan:** none — every code step carries real code.
- **Known cross-task build gap:** the tree does not fully build until Task 8 removes the last `groq-key-pool` import; tasks are ordered so the final state of each is green on `npm test` for the files it owns, and `npm test`/`npm run build` are fully green from Task 8 onward. Execute in order.







