# PromptGuard Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a Next.js 16 + TypeScript + Tailwind 4 app with Prisma 7 on local Postgres, the complete database schema (game tables plus key-pool tables), the hand-edited partial unique index, and a seeded word pool — so that later phases have a working, migrated, testable base.

**Architecture:** Next.js App Router with all application code under `src/`. Configuration and cross-cutting concerns (environment parsing, the Prisma client) live in small focused modules under `src/lib/` so later phases import them rather than repeating them. Database changes go through checked-in Prisma migrations; the one constraint Prisma cannot express (a partial unique index) is appended to the generated migration SQL by hand.

**Tech Stack:** Next.js 16.3.6, React 19.3.0, TypeScript 7.0.2, Tailwind CSS 4.3.3, Prisma 7.10.0 with `@prisma/adapter-pg`, PostgreSQL 18 (local), Vitest 5.0.1, tsx 4.23.15.

## Global Constraints

- Node 22.22.1, npm 9.2.0. Postgres 18 runs locally at `/var/run/postgresql:5432`; no Docker.
- Pinned versions, exact: `next@16.3.6`, `react@19.3.0`, `react-dom@19.3.0`, `@prisma/client@7.10.0`, `prisma@7.10.0`, `@prisma/adapter-pg@7.10.0`, `tailwindcss@4.3.3`, `@tailwindcss/postcss@4.3.3`, `typescript@7.0.2`, `vitest@5.0.1`, `tsx@4.23.15`, `dotenv@18.0.3`, `@types/node@26.6.2`.
- **TypeScript escape hatch:** if `npm run build` type-checking fails in a way that points at the native compiler (TypeScript 7), pin `typescript@5.9.3` and re-run. No source changes should be needed.
- TypeScript must be clean and typed. **No `any`.** Use `unknown` plus narrowing, or a specific interface.
- **Migrations, never `db push`.** `npx prisma migrate dev` for every schema change.
- Prisma 7 specifics: `prisma.config.ts` carries the datasource URL (the `datasource` block no longer holds `url`); the generator is `prisma-client` with a required `output`; the client is constructed with `new PrismaPg({ connectionString })`; `migrate dev` no longer auto-runs `generate` or `seed`, both must be invoked explicitly; the seed script is registered under `migrations.seed` in `prisma.config.ts`, not in `package.json`.
- Environment variable names are fixed: `DATABASE_URL`, `AUTH_SECRET` (**not** `NEXTAUTH_SECRET` — that is the v4 name), `GROQ_API_KEYS`, `GROQ_KEY_RPD`, `GROQ_KEY_RPM`, `ADMIN_EMAILS`, `GUARDIAN_QUEUE_MAX_WAIT_MS`, `GUARDIAN_QUEUE_POLL_MS`.
- The number of Groq API keys is never hardcoded; the pool reads however many comma-separated values are present (4 today, ~15 later).
- Commit after every task, on `main`, local only. No push (no credentials on this machine). Commit messages follow Conventional Commits and end with the `Co-Authored-By: Claude Code <noreply@anthropic.com>` trailer.
- All application code lives under `src/`. Path alias `@/*` maps to `src/*`.
- This plan touches no guardian, auth, or key-pool logic — those are phases 2–4. Nothing in this phase may import `groq-sdk` or `next-auth`.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs` | Scaffolded by `create-next-app`, then modified (test scripts, postinstall generate) |
| `vitest.config.ts` | Vitest config: node environment, `@` alias, test file glob |
| `src/lib/env.ts` | Parse and validate the environment once. Exports `env` plus the pure helpers `parseList` and `optionalInt` |
| `src/lib/env.test.ts` | Tests for the two pure helpers |
| `.env.example` | Documented list of every variable, with safe placeholders |
| `prisma.config.ts` | Prisma 7 config: schema path, migrations path, seed command, datasource URL |
| `prisma/schema.prisma` | Full data model: `User`, `Word`, `GameSession`, `Attempt`, `ApiKeyDailyUsage`, `ApiKeyRequestLog`, `ApiKeyCooldown` |
| `prisma/migrations/*_init/migration.sql` | Generated, then hand-edited to append the partial unique index |
| `prisma/seed.ts` | Insert the word pool, idempotent |
| `src/lib/prisma.ts` | `PrismaClient` singleton with the pg adapter, dev-hot-reload safe |
| `.gitignore` | Scaffolded, plus `src/generated/` |
| `README.md` | Setup: Postgres role/database, migrations, generate, seed, dev server |

---

### Task 1: Scaffold the Next.js app and Vitest

The repo already contains `.git`, `README.md` and `docs/`, so `create-next-app` is run in a scratch directory and its output copied in. This avoids the generator refusing to run in a non-empty directory, and avoids it creating a competing git history or clobbering our README.

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `src/app/` (scaffolded), `vitest.config.ts`
- Modify: `package.json` (scripts)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run build`, `npm run dev`, `npm test` all work. `@/*` resolves to `src/*`.

- [ ] **Step 1: Scaffold into a scratch directory**

```bash
cd /tmp && rm -rf pg-scaffold && npx --yes create-next-app@16.3.6 pg-scaffold \
  --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
```

If any flag is rejected by this version of `create-next-app`, run `npx create-next-app@16.3.6 --help` and use the equivalent; the required outcome is TypeScript, Tailwind, ESLint, App Router, a `src/` directory, and the `@/*` alias.

- [ ] **Step 2: Copy the scaffold into the repo**

```bash
cd /home/tarang/recurse/Prompt-Injection-Gandalf
rsync -a --exclude .git --exclude node_modules --exclude README.md /tmp/pg-scaffold/ ./
ls -A
```

Expected: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `src/`, plus the existing `README.md` and `docs/`. `.git` is untouched.

- [ ] **Step 3: Install dependencies and confirm the scaffold builds**

```bash
npm install
npm run build
```

Expected: build succeeds. (Local Postgres is irrelevant at this point; nothing connects yet.)

- [ ] **Step 4: Add Vitest**

```bash
npm install -D vitest@5.0.1 tsx@4.23.15 dotenv@18.0.3
```

Create `vitest.config.ts` at the repo root:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
```

(`fileURLToPath` rather than `__dirname`, because a `.ts` config is loaded as ESM.)

- [ ] **Step 5: Add the test script and the postinstall generate hook**

In `package.json`, the `scripts` block must contain:

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "test": "vitest run",
  "test:watch": "vitest",
  "postinstall": "prisma generate",
  "db:migrate": "prisma migrate dev",
  "db:generate": "prisma generate",
  "db:seed": "prisma db seed",
  "db:studio": "prisma studio"
}
```

Leave the scaffolded `dev`/`build`/`start`/`lint` values exactly as generated if they differ in wording. `postinstall` is safe to add now even though `prisma` is not installed until Task 3 — but if `npm install` is run before then it will fail, so add `postinstall` in Task 3 Step 1 instead if you are running the steps strictly in order.

- [ ] **Step 6: Add the generated client and local env to `.gitignore`**

Append to `.gitignore`:

```
# Prisma generated client (regenerated by `prisma generate`)
/src/generated/

# local env
.env
.env.local
```

- [ ] **Step 7: Write a placeholder test that proves the runner works**

Create `src/lib/env.test.ts` with only this, to be replaced in Task 2:

```ts
import { describe, expect, it } from "vitest";

describe("vitest", () => {
  it("runs", () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 8: Run the tests**

Run: `npm test`
Expected: PASS, 1 test.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js 16 app with Tailwind 4 and Vitest

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Environment parsing

Environment access is centralised so that a missing variable fails loudly at boot with a readable message, rather than producing an `undefined` that surfaces later as a confusing API error. The two pure helpers are exported separately so they can be tested without the eager top-level validation firing at import time.

**Files:**
- Create: `src/lib/env.ts`
- Modify: `src/lib/env.test.ts` (replace the placeholder)
- Create: `.env.example`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseList(raw: string): string[]`, `optionalInt(name: string, fallback: number): number`, and the frozen object `env` with fields `databaseUrl: string`, `authSecret: string`, `groqApiKeys: string[]`, `groqKeyRpd: number`, `groqKeyRpm: number`, `adminEmails: string[]`, `queueMaxWaitMs: number`, `queuePollMs: number`.

- [ ] **Step 1: Write the failing tests**

Replace `src/lib/env.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { optionalInt, parseList } from "./env";

describe("parseList", () => {
  it("splits on commas and trims each entry", () => {
    expect(parseList("a, b ,c")).toEqual(["a", "b", "c"]);
  });

  it("drops empty entries", () => {
    expect(parseList("a,,b,")).toEqual(["a", "b"]);
  });

  it("returns an empty array for an empty or whitespace string", () => {
    expect(parseList("")).toEqual([]);
    expect(parseList("   ")).toEqual([]);
  });

  it("does not hardcode a key count", () => {
    const four = parseList("k1,k2,k3,k4");
    const fifteen = parseList(Array.from({ length: 15 }, (_, i) => `k${i}`).join(","));
    expect(four).toHaveLength(4);
    expect(fifteen).toHaveLength(15);
  });

  it("preserves a single key", () => {
    expect(parseList("only-one")).toEqual(["only-one"]);
  });
});

describe("optionalInt", () => {
  const NAME = "PROMPTGUARD_TEST_INT";

  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env[NAME];
  });

  it("returns the fallback when unset", () => {
    delete process.env[NAME];
    expect(optionalInt(NAME, 42)).toBe(42);
  });

  it("returns the fallback when blank", () => {
    process.env[NAME] = "   ";
    expect(optionalInt(NAME, 42)).toBe(42);
  });

  it("parses a valid value", () => {
    process.env[NAME] = "1000";
    expect(optionalInt(NAME, 42)).toBe(1000);
  });

  it("throws on a non-numeric value, naming the variable", () => {
    process.env[NAME] = "many";
    expect(() => optionalInt(NAME, 42)).toThrowError(/PROMPTGUARD_TEST_INT/);
  });

  it("throws on zero or a negative value", () => {
    process.env[NAME] = "0";
    expect(() => optionalInt(NAME, 42)).toThrowError(/positive integer/);
    process.env[NAME] = "-3";
    expect(() => optionalInt(NAME, 42)).toThrowError(/positive integer/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/env.test.ts`
Expected: FAIL — `Failed to resolve import "./env"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/env.ts`:

```ts
import "dotenv/config";

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

export const env = {
  databaseUrl: required("DATABASE_URL"),
  /** Auth.js v5 reads AUTH_SECRET. NEXTAUTH_SECRET is the v4 name and is not used. */
  authSecret: required("AUTH_SECRET"),
  groqApiKeys: parseList(required("GROQ_API_KEYS")),
  groqKeyRpd: optionalInt("GROQ_KEY_RPD", 1000),
  groqKeyRpm: optionalInt("GROQ_KEY_RPM", 30),
  /** Lowercased so the admin allowlist comparison is case-insensitive. */
  adminEmails: parseList(process.env.ADMIN_EMAILS ?? "").map((email) =>
    email.toLowerCase(),
  ),
  queueMaxWaitMs: optionalInt("GUARDIAN_QUEUE_MAX_WAIT_MS", 12_000),
  queuePollMs: optionalInt("GUARDIAN_QUEUE_POLL_MS", 300),
} as const;

export type Env = typeof env;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/env.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Create `.env.example`**

```
# --- Database ---------------------------------------------------------------
# Local Postgres 18. Create the role and database as described in the README.
DATABASE_URL="postgresql://promptguard:promptguard@localhost:5432/promptguard?schema=public"

# --- Auth -------------------------------------------------------------------
# Generate with: npx auth secret
# Auth.js v5 reads AUTH_SECRET. Do NOT use NEXTAUTH_SECRET, which is the v4 name.
AUTH_SECRET="replace-me-with-a-generated-secret"

# --- Groq -------------------------------------------------------------------
# Comma-separated. Four keys now, ~15 for the live event. Nothing hardcodes the count.
GROQ_API_KEYS="gsk_key1,gsk_key2,gsk_key3,gsk_key4"

# Per-key free-tier limits for openai/gpt-oss-120b. Override only if Groq changes them.
GROQ_KEY_RPD=1000
GROQ_KEY_RPM=30

# --- Admin ------------------------------------------------------------------
# Comma-separated allowlist for /api/admin/keys. Empty means nobody.
ADMIN_EMAILS="you@example.com"

# --- Guardian queueing (optional, defaults shown) ---------------------------
GUARDIAN_QUEUE_MAX_WAIT_MS=12000
GUARDIAN_QUEUE_POLL_MS=300
```

- [ ] **Step 6: Verify the app still builds with env variables absent**

Run: `npm run build`
Expected: build succeeds. `env.ts` is not imported by any page yet, so its eager validation does not run during the build. If the build fails here, it means something scaffolded already imports it — check and remove that import.

- [ ] **Step 7: Commit**

```bash
git add src/lib/env.ts src/lib/env.test.ts .env.example .gitignore
git commit -m "feat: centralised environment parsing with fail-fast validation

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Prisma 7 schema, first migration, and client singleton

The whole data model lands in one migration: the three game tables and the three key-pool tables. The key-pool tables are created now rather than in phase 4 so there is a single `init` migration rather than a schema change mid-build.

**Files:**
- Create: `prisma.config.ts`, `prisma/schema.prisma`, `prisma/migrations/*_init/migration.sql`, `src/lib/prisma.ts`
- Modify: `package.json` (add `postinstall` if not added in Task 1)

**Interfaces:**
- Consumes: `env.databaseUrl` from Task 2.
- Produces: `prisma` (a `PrismaClient`) from `@/lib/prisma`; the generated client at `src/generated/prisma/client`; models `User`, `Word`, `GameSession`, `Attempt`, `ApiKeyDailyUsage`, `ApiKeyRequestLog`, `ApiKeyCooldown`; enums `Tier` (`APPRENTICE | ADEPT | ARCHMAGE`) and `SessionStatus` (`IN_PROGRESS | WON | ABANDONED`).

- [ ] **Step 1: Install Prisma and set up the local database**

```bash
npm install @prisma/client@7.10.0 @prisma/adapter-pg@7.10.0
npm install -D prisma@7.10.0

sudo -u postgres psql -c "CREATE ROLE promptguard LOGIN PASSWORD 'promptguard' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE promptguard OWNER promptguard;"
```

`CREATEDB` is needed by `prisma migrate dev` for its shadow database.

Create `.env` from the example and fill in a real secret:

```bash
cp .env.example .env
npx auth secret
```

- [ ] **Step 2: Write `prisma.config.ts`**

```ts
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
```

Note: `env()` throws if the variable is undefined, which is the behaviour we want — a missing `DATABASE_URL` should stop the command immediately.

- [ ] **Step 3: Write the schema**

Create `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

enum Tier {
  APPRENTICE
  ADEPT
  ARCHMAGE
}

enum SessionStatus {
  IN_PROGRESS
  WON
  ABANDONED
}

model User {
  id           String        @id @default(cuid())
  email        String        @unique
  passwordHash String
  createdAt    DateTime      @default(now())
  sessions     GameSession[]
}

/// The shared pool of secret words. A word is never shorter than four letters:
/// the leak scanner's separator-squeeze layer relies on that floor to avoid
/// matching short words inside ordinary prose.
model Word {
  id       String        @id @default(cuid())
  text     String        @unique
  tier     Tier
  active   Boolean       @default(true)
  sessions GameSession[]
}

model GameSession {
  id        String        @id @default(cuid())
  userId    String
  wordId    String
  tier      Tier
  /// Passes through this tier. Increments when every word in the tier has been
  /// assigned to this user at the current cycle, which is how the pool recycles
  /// instead of dead-ending.
  cycle     Int           @default(0)
  status    SessionStatus @default(IN_PROGRESS)
  /// Set when a session exceeds 20 attempts in 5 minutes, i.e. looks automated.
  flagged   Boolean       @default(false)
  createdAt DateTime      @default(now())
  endedAt   DateTime?
  user      User          @relation(fields: [userId], references: [id])
  word      Word          @relation(fields: [wordId], references: [id])
  attempts  Attempt[]

  @@index([userId, tier, cycle])
  @@index([userId, status])
}

model Attempt {
  id          String      @id @default(cuid())
  sessionId   String
  /// The player's raw message. Sanitisation happens when the prompt history is
  /// rebuilt, so the original attack text stays available for review.
  userMessage String
  aiResponse  String
  leaked      Boolean     @default(false)
  createdAt   DateTime    @default(now())
  session     GameSession @relation(fields: [sessionId], references: [id])

  @@index([sessionId, createdAt])
}

/// One row per Groq key per UTC day. Incremented atomically.
model ApiKeyDailyUsage {
  keyIndex Int
  date     DateTime @db.Date
  count    Int      @default(0)

  @@unique([keyIndex, date])
}

/// One row per Groq request, so the per-minute window can be counted as a
/// sliding 60-second window rather than a fixed bucket that can be burst at the
/// boundary. Pruned opportunistically; see lib/groq-key-pool.ts.
model ApiKeyRequestLog {
  id        String   @id @default(cuid())
  keyIndex  Int
  createdAt DateTime @default(now())

  @@index([keyIndex, createdAt])
}

/// A key Groq itself reported as rate-limited. Kept in the database so a server
/// restart does not lose it, since Groq's clock is the authority, not ours.
model ApiKeyCooldown {
  keyIndex       Int      @id
  exhaustedUntil DateTime
}
```

- [ ] **Step 4: Create the migration without applying it**

```bash
npx prisma migrate dev --create-only --name init
```

Expected: a new directory `prisma/migrations/<timestamp>_init/` containing `migration.sql`.

- [ ] **Step 5: Append the partial unique index by hand**

Open `prisma/migrations/<timestamp>_init/migration.sql` and append this at the end:

```sql
-- Prisma cannot express partial indexes, so this one is maintained by hand.
-- It makes "at most one IN_PROGRESS session per user" a database invariant
-- rather than something two concurrent /api/session/start calls can race past.
CREATE UNIQUE INDEX "game_session_one_active_per_user"
  ON "GameSession" ("userId")
  WHERE status = 'IN_PROGRESS';
```

- [ ] **Step 6: Apply the migration and generate the client**

```bash
npx prisma migrate dev
npx prisma generate
```

Expected: migration applies cleanly; `src/generated/prisma/` exists.

- [ ] **Step 7: Verify the index exists in the database**

```bash
psql "postgresql://promptguard:promptguard@localhost:5432/promptguard" \
  -c "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'GameSession';"
```

Expected: six rows including `game_session_one_active_per_user` with `WHERE (status = 'IN_PROGRESS'::"SessionStatus")` in its definition. If that row is missing, the hand-edit was not saved before `migrate dev` ran — roll back with `npx prisma migrate reset` and redo steps 4–6.

- [ ] **Step 8: Confirm the generated client's entry point**

```bash
ls src/generated/prisma | head -30
```

Expected: the generated files include a `client.ts` (or `client.js` plus `client.d.ts`). The import path used in Step 9 assumes `src/generated/prisma/client`. If the layout differs, adjust the import in `src/lib/prisma.ts` to the actual entry point — check `src/generated/prisma/index.ts` or the package's `exports` before moving on.

- [ ] **Step 9: Write the client singleton**

Create `src/lib/prisma.ts`:

```ts
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/lib/env";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Prisma 7 requires a driver adapter. The generated client lives outside
 * node_modules, so it is imported from src/generated rather than @prisma/client.
 *
 * Cached on globalThis so Next's dev-mode hot reload does not open a new pool on
 * every edit.
 */
const globalForPrisma = globalThis as unknown as { promptguardPrisma?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.databaseUrl });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalForPrisma.promptguardPrisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.promptguardPrisma = prisma;
}
```

- [ ] **Step 10: Verify the client connects**

Create a temporary script `scripts/db-check.ts`:

```ts
import { prisma } from "../src/lib/prisma";

async function main(): Promise<void> {
  const [words, sessions] = await Promise.all([
    prisma.word.count(),
    prisma.gameSession.count(),
  ]);
  console.log(`words=${words} sessions=${sessions}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
```

Run: `npx tsx scripts/db-check.ts`
Expected: `words=0 sessions=0`.

Delete the script afterwards — it is scaffolding, not a deliverable:

```bash
rm scripts/db-check.ts
```

- [ ] **Step 11: Confirm the whole app still builds and tests pass**

Run: `npm test && npm run build`
Expected: tests PASS; build succeeds.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: add Prisma 7 schema, init migration with partial unique index, and client singleton

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: Word pool seed and setup documentation

Words are grouped by tier and inserted idempotently, so re-running the seed is safe. Alongside it, the README gains the setup path a fresh clone needs — which for Prisma 7 has three non-obvious steps: `migrate dev` does not generate, `migrate dev` does not seed, and the seed command lives in `prisma.config.ts`.

**Files:**
- Create: `prisma/seed.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `prisma` from Task 3; the `Tier` enum from the generated client.
- Produces: 40 active words per tier (120 total), lowercase, single words, none shorter than four letters.

- [ ] **Step 1: Write the seed script**

Create `prisma/seed.ts`:

```ts
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { Tier } from "../src/generated/prisma/enums";

/**
 * The shared word pool. Rules for entries, all of which matter to the leak
 * scanner or to gameplay:
 *   - lowercase, single words, ASCII letters only
 *   - never shorter than four letters, so the separator-squeeze scan layer
 *     cannot fire on ordinary prose
 *   - no proper nouns, no brand names
 *   - nothing that is a substring of a very common word, to keep false wins rare
 */
const WORDS: Record<Tier, string[]> = {
  [Tier.APPRENTICE]: [
    "anchor", "basket", "beacon", "breeze", "cactus", "candle", "carpet", "castle",
    "celery", "cherry", "cobalt", "comedy", "compass", "copper", "cricket", "dagger",
    "dolphin", "ember", "fabric", "falcon", "feather", "ginger", "glacier", "goblin",
    "hammer", "harbor", "helmet", "hollow", "ivory", "jacket", "kettle", "lantern",
    "lizard", "marble", "meadow", "mitten", "nectar", "nutmeg", "olive", "otter",
  ],
  [Tier.ADEPT]: [
    "abacus", "amulet", "anvil", "apron", "arbour", "basalt", "bezel", "bramble",
    "cadence", "caliper", "cauldron", "chisel", "cinder", "clarity", "cobble", "crucible",
    "damask", "decanter", "dovetail", "dulcet", "elixir", "errant", "fathom", "ferrous",
    "flagon", "gambit", "gantry", "gossamer", "harvest", "hearth", "inlaid", "juniper",
    "kestrel", "kindling", "lattice", "lichen", "lodestone", "mandolin", "mirth", "myrtle",
  ],
  [Tier.ARCHMAGE]: [
    "abecedarian", "adjuration", "alembic", "anathema", "apocrypha", "arcanum", "augury",
    "bedevil", "calumny", "catacomb", "chimerical", "cognoscenti", "conundrum", "cupidity",
    "defenestration", "desultory", "diaphanous", "dissemble", "effulgent", "eldritch",
    "ephemeral", "evanescent", "farrago", "fulminate", "gallimaufry", "hierophant",
    "ineffable", "labyrinthine", "liminal", "mellifluous", "munificent", "obfuscate",
    "palimpsest", "penumbra", "perspicacious", "quiescent", "recalcitrant", "sagacious",
    "susurrus", "vellichor",
  ],
};

function assertPoolRules(): void {
  const all = Object.values(WORDS).flat();
  const seen = new Set<string>();
  for (const word of all) {
    if (!/^[a-z]+$/.test(word)) {
      throw new Error(`Word "${word}" must be lowercase ASCII letters only`);
    }
    if (word.length < 4) {
      throw new Error(`Word "${word}" is shorter than four letters`);
    }
    if (seen.has(word)) {
      throw new Error(`Word "${word}" is duplicated in the pool`);
    }
    seen.add(word);
  }
}

async function main(): Promise<void> {
  assertPoolRules();

  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString === "") {
    throw new Error("DATABASE_URL is not set");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    let created = 0;
    for (const [tier, words] of Object.entries(WORDS)) {
      for (const text of words) {
        const existing = await prisma.word.findUnique({ where: { text } });
        if (existing !== null) {
          // Do not resurrect a word that was deliberately deactivated.
          continue;
        }
        await prisma.word.create({ data: { text, tier: tier as Tier } });
        created += 1;
      }
    }
    const total = await prisma.word.count({ where: { active: true } });
    console.log(`seed: created ${created}, pool now holds ${total} active words`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
```

If `src/generated/prisma/enums` does not exist after generation, import `Tier` from the client entry point instead (`import { PrismaClient, Tier } from "../src/generated/prisma/client"`) — check which the generator emitted before running the seed.

- [ ] **Step 2: Run the seed**

```bash
npm run db:seed
```

Expected: `seed: created 120, pool now holds 120 active words`.

- [ ] **Step 3: Run the seed again to prove it is idempotent**

```bash
npm run db:seed
```

Expected: `seed: created 0, pool now holds 120 active words`.

- [ ] **Step 4: Verify the pool split in the database**

```bash
psql "postgresql://promptguard:promptguard@localhost:5432/promptguard" \
  -c "SELECT tier, count(*), min(length(text)) AS shortest FROM \"Word\" GROUP BY tier ORDER BY tier;"
```

Expected: three rows, 40 each, shortest length 4 for APPRENTICE, longer for the others.

- [ ] **Step 5: Write the README**

Replace `README.md` with:

````markdown
# PromptGuard

A prompt-injection game. You are assigned a secret word; an AI guardian is told to protect it.
Talk the guardian into revealing it.

Decisions behind the design, including the security model and the Groq key-pool behaviour, are in
[docs/superpowers/specs/2026-09-25-promptguard-design.md](docs/superpowers/specs/2026-09-25-promptguard-design.md).

## Requirements

- Node 22+
- PostgreSQL 18 (local install; no Docker required)
- One or more Groq API keys — the pool reads however many are supplied

## Setup

### 1. Database

```bash
sudo -u postgres psql -c "CREATE ROLE promptguard LOGIN PASSWORD 'promptguard' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE promptguard OWNER promptguard;"
```

`CREATEDB` is required by `prisma migrate dev`, which creates and drops a shadow database to detect
schema drift.

### 2. Environment

```bash
cp .env.example .env
npx auth secret        # writes AUTH_SECRET
```

Then edit `.env`:

- `DATABASE_URL` — matches the role and database above
- `GROQ_API_KEYS` — comma-separated keys, e.g. `gsk_a,gsk_b,gsk_c,gsk_d`. The pool is
  size-agnostic; adding keys needs no code change
- `ADMIN_EMAILS` — who may read `/api/admin/keys`

Note: this project uses `AUTH_SECRET`. `NEXTAUTH_SECRET` is the Auth.js v4 name and is ignored.

### 3. Install, migrate, seed

```bash
npm install
npx prisma migrate dev     # applies migrations
npx prisma generate        # required: migrate dev does not generate in Prisma 7
npx prisma db seed         # required: migrate dev does not seed in Prisma 7
```

The seed command is registered in `prisma.config.ts` under `migrations.seed`, not in
`package.json`. The word pool seed is idempotent, so re-running it is safe.

### 4. Run

```bash
npm run dev
```

`npm test` runs the unit suite; `npm run build` type-checks and builds.

## Schema changes

Always through migrations, never `prisma db push`:

```bash
npx prisma migrate dev --name your_change
npx prisma generate
```

One constraint is maintained by hand: a partial unique index enforcing at most one `IN_PROGRESS`
session per user. It is appended to the generated migration SQL because Prisma cannot model partial
indexes. If a future migration tries to drop it, keep it.
````

- [ ] **Step 6: Follow the README from scratch to prove it works**

```bash
npx prisma migrate status
npm test
npm run build
```

Expected: migrations reported as up to date and applied; tests PASS; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add prisma/seed.ts README.md
git commit -m "feat: seed the word pool and document local setup

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Phase 1 exit criteria

- `npm run build` succeeds, `npm test` passes.
- `prisma/migrations` contains one applied `init` migration, and `pg_indexes` shows
  `game_session_one_active_per_user` with its `WHERE status = 'IN_PROGRESS'` predicate.
- The database holds 120 active words, 40 per tier, and re-seeding creates nothing.
- `src/lib/env.ts` throws a named error on a missing `DATABASE_URL`, `AUTH_SECRET` or `GROQ_API_KEYS`.
- `git log` shows one commit per task.

## Notes for later phases

- Phase 2 (auth) adds `src/lib/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`,
  `src/app/api/auth/signup/route.ts`, and the login/signup pages. It introduces `bcryptjs@3.0.3`.
- Phase 3 (game core) adds `src/lib/guardian/{prompt,sanitize}.ts`, `src/lib/leak-detection.ts`, and
  `src/lib/game/{session-service,tier}.ts` with their unit tests.
- Phase 4 (key pool) adds `src/lib/groq-key-pool.ts`, `groq-sdk@1.6.0`, `/api/admin/keys`, and
  `scripts/loadtest.ts`. It is the first phase that touches `ApiKey*` tables, which already exist.
- Phase 5 (frontend) adds the chat UI and dashboard. Phase 6 completes documentation.
