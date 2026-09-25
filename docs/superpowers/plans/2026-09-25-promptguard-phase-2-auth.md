# PromptGuard Phase 2 — Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email/password signup and login using Auth.js v5 with a credentials provider, bcrypt-hashed passwords, JWT sessions carrying `user.id`, and a minimal authenticated page shell — so phase 3 can identify the current user in every route handler.

**Architecture:** Auth.js v5 owns the session (`src/lib/auth.ts` exports `auth`, `handlers`, `signIn`, `signOut`). Signup is a plain route handler, deliberately *not* part of Auth.js, because it creates a row rather than establishing a session. Credential parsing is a pure function in `src/lib/validation.ts` so both the signup route and the credentials provider validate identically. Password hashing is isolated in `src/lib/auth/password.ts` with an injectable cost, so tests do not pay for production-grade hashing.

**Tech Stack:** Next.js 16.3.6 App Router, React 19.3.0, TypeScript 7.0.2, Auth.js v5 (`next-auth@5.0.0-beta.32`), `bcryptjs@3.0.3`, Prisma 7.10.0, Vitest 5.0.1.

## Global Constraints

- Depends on phase 1 being complete: `prisma` exported from `@/lib/prisma`, `env` from `@/lib/env`, the `User` model migrated, `@/*` aliasing `src/*`.
- Pinned versions, exact: `next-auth@5.0.0-beta.32`, `bcryptjs@3.0.3`. Add `@types/bcryptjs` **only** if `bcryptjs@3.0.3` ships no bundled types — check first, since v3 includes its own.
- Session strategy is **JWT**, not database. This keeps Auth.js decoupled from the Prisma schema: no adapter, no `Account`/`Session`/`VerificationToken` tables.
- The session must carry `user.id` — every later phase's route handler calls `auth()` and needs it. `user.email` is also needed, for the `ADMIN_EMAILS` allowlist.
- `AUTH_SECRET` is the v5 variable name. Do not reference `NEXTAUTH_SECRET` anywhere.
- Environment access goes through `env` from `@/lib/env`. Do not read `process.env` for these values in new code.
- **No `any`.** The `authorize` callback takes `Partial<Record<string, unknown>>`; narrow it through the shared validator rather than casting.
- Passwords: minimum 8 characters. bcrypt cost 12 in production, injectable so tests use 4.
- Error responses are JSON with a readable `error` field. Never leak whether an email exists beyond the signup 409 (which is unavoidable) — the login path returns a generic failure.
- Commit after every task, on `main`, local only. Commit messages end with the `Co-Authored-By: Claude Code <noreply@anthropic.com>` trailer.
- This phase must not import `groq-sdk` or touch guardian logic.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `src/lib/auth/password.ts` | `hashPassword`, `verifyPassword`, `BCRYPT_COST`. Cost injectable for tests |
| `src/lib/auth/password.test.ts` | Hashing round-trip, wrong password, distinct salts, cost injection |
| `src/lib/validation.ts` | `readCredentials(input: unknown): CredentialsResult` — shared by signup and login |
| `src/lib/validation.test.ts` | Trim/lowercase, length rule, non-string and missing fields, oversized input |
| `src/app/api/auth/signup/route.ts` | POST: validate, hash, create user, 201 / 400 / 409 |
| `src/app/api/auth/signup/route.test.ts` | Route tests against a mocked `@/lib/prisma` |
| `src/lib/auth.ts` | Auth.js v5 config: credentials provider, JWT callbacks, `trustHost` |
| `src/app/api/auth/[...nextauth]/route.ts` | Re-exports `handlers` as `GET`/`POST` |
| `src/types/next-auth.d.ts` | Module augmentation so `session.user.id` is `string`, not `string | undefined` |
| `src/app/(auth)/login/page.tsx` | Login form |
| `src/app/(auth)/signup/page.tsx` | Signup form |
| `src/app/(auth)/layout.tsx` | Centred card layout shared by both pages |
| `src/app/page.tsx` | Minimal authenticated shell: greets the user, offers sign-out. Replaced in phase 5 |
| `src/components/sign-out-button.tsx` | Client component calling `signOut` |

---

### Task 1: Password hashing

**Files:**
- Create: `src/lib/auth/password.ts`
- Test: `src/lib/auth/password.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BCRYPT_COST: 12`, `hashPassword(plain: string, cost?: number): Promise<string>`, `verifyPassword(plain: string, hash: string): Promise<boolean>`.

- [ ] **Step 1: Install bcryptjs**

```bash
npm install bcryptjs@3.0.3
ls node_modules/bcryptjs/*.d.ts 2>/dev/null || echo "no bundled types"
```

If that prints `no bundled types`, also run `npm install -D @types/bcryptjs`. If it lists `.d.ts` files, bcryptjs 3 ships its own types and adding `@types/bcryptjs` would conflict.

- [ ] **Step 2: Write the failing tests**

Create `src/lib/auth/password.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BCRYPT_COST, hashPassword, verifyPassword } from "./password";

/** Cheap cost so the suite stays fast; production cost is asserted separately. */
const TEST_COST = 4;

describe("BCRYPT_COST", () => {
  it("is 12, high enough to make offline cracking expensive", () => {
    expect(BCRYPT_COST).toBe(12);
  });
});

describe("hashPassword", () => {
  it("never returns the plaintext", async () => {
    const hash = await hashPassword("correct horse battery", TEST_COST);
    expect(hash).not.toContain("correct horse battery");
    expect(hash.startsWith("$2")).toBe(true);
  });

  it("produces a different hash each time, because the salt is random", async () => {
    const first = await hashPassword("same password", TEST_COST);
    const second = await hashPassword("same password", TEST_COST);
    expect(first).not.toBe(second);
  });

  it("uses the injected cost", async () => {
    const hash = await hashPassword("anything", TEST_COST);
    expect(hash.slice(0, 7)).toBe("$2b$04$");
  });
});

describe("verifyPassword", () => {
  it("accepts the correct password", async () => {
    const hash = await hashPassword("correct horse battery", TEST_COST);
    await expect(verifyPassword("correct horse battery", hash)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery", TEST_COST);
    await expect(verifyPassword("Correct horse battery", hash)).resolves.toBe(false);
  });

  it("rejects an empty password", async () => {
    const hash = await hashPassword("correct horse battery", TEST_COST);
    await expect(verifyPassword("", hash)).resolves.toBe(false);
  });

  it("resolves false rather than throwing on a malformed hash", async () => {
    await expect(verifyPassword("whatever", "not-a-bcrypt-hash")).resolves.toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- src/lib/auth/password.test.ts`
Expected: FAIL — `Failed to resolve import "./password"`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/auth/password.ts`:

```ts
import bcrypt from "bcryptjs";

/**
 * bcrypt cost. bcryptjs is pure JavaScript, so a cost of 12 costs roughly a
 * quarter-second per hash on a typical machine. That is a deliberate tax on
 * offline cracking, and it only runs on signup and login.
 */
export const BCRYPT_COST = 12;

export async function hashPassword(plain: string, cost: number = BCRYPT_COST): Promise<string> {
  return bcrypt.hash(plain, cost);
}

/**
 * Returns false rather than throwing when the stored hash is malformed, so a
 * corrupted row cannot turn a failed login into a 500.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (hash.startsWith("$2") === false) {
    return false;
  }
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}
```

If `import bcrypt from "bcryptjs"` fails to type-check, use the named imports the v3 ESM build provides instead: `import { compare, hash } from "bcryptjs"`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- src/lib/auth/password.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/password.ts src/lib/auth/password.test.ts package.json package-lock.json
git commit -m "feat: add bcrypt password hashing with injectable cost

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Credential validation

One validator serves both paths — signup and the credentials provider's `authorize` — so the two can never drift apart on what counts as a valid email or an acceptable password length.

**Files:**
- Create: `src/lib/validation.ts`
- Test: `src/lib/validation.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export const MIN_PASSWORD_LENGTH = 8;
export type CredentialsResult =
  | { ok: true; email: string; password: string }
  | { ok: false; error: string };
export function readCredentials(input: unknown): CredentialsResult;
```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/validation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MIN_PASSWORD_LENGTH, readCredentials } from "./validation";

function expectFailure(result: ReturnType<typeof readCredentials>): string {
  if (result.ok) {
    throw new Error("expected validation to fail, but it succeeded");
  }
  return result.error;
}

describe("readCredentials", () => {
  it("accepts a well-formed pair", () => {
    const result = readCredentials({ email: "player@example.com", password: "hunter2hunter2" });
    expect(result).toEqual({ ok: true, email: "player@example.com", password: "hunter2hunter2" });
  });

  it("trims the email and lowercases it, so casing cannot create a second account", () => {
    const result = readCredentials({ email: "  Player@Example.COM  ", password: "hunter2hunter2" });
    expect(result.ok && result.email).toBe("player@example.com");
  });

  it("leaves the password untouched, including surrounding spaces", () => {
    const result = readCredentials({ email: "a@b.co", password: "  spaced out  " });
    expect(result.ok && result.password).toBe("  spaced out  ");
  });

  it("rejects a non-object input", () => {
    expect(expectFailure(readCredentials(null))).toMatch(/email and password/i);
    expect(expectFailure(readCredentials("nope"))).toMatch(/email and password/i);
    expect(expectFailure(readCredentials(undefined))).toMatch(/email and password/i);
  });

  it("rejects non-string fields", () => {
    expect(expectFailure(readCredentials({ email: 42, password: "hunter2hunter2" }))).toMatch(/email and password/i);
    expect(expectFailure(readCredentials({ email: "a@b.co", password: { nested: true } }))).toMatch(/email and password/i);
  });

  it("rejects an empty email", () => {
    expect(expectFailure(readCredentials({ email: "   ", password: "hunter2hunter2" }))).toMatch(/email/i);
  });

  it("rejects an email without a single @ and a dot after it", () => {
    expect(expectFailure(readCredentials({ email: "not-an-email", password: "hunter2hunter2" }))).toMatch(/email/i);
    expect(expectFailure(readCredentials({ email: "no@dot", password: "hunter2hunter2" }))).toMatch(/email/i);
  });

  it("rejects a password below the minimum length, naming the length", () => {
    const short = "a".repeat(MIN_PASSWORD_LENGTH - 1);
    expect(expectFailure(readCredentials({ email: "a@b.co", password: short }))).toContain(String(MIN_PASSWORD_LENGTH));
  });

  it("accepts a password exactly at the minimum length", () => {
    const exact = "a".repeat(MIN_PASSWORD_LENGTH);
    expect(readCredentials({ email: "a@b.co", password: exact }).ok).toBe(true);
  });

  it("rejects an absurdly long password instead of hashing it", () => {
    const huge = "a".repeat(1_001);
    expect(expectFailure(readCredentials({ email: "a@b.co", password: huge }))).toMatch(/too long/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/validation.test.ts`
Expected: FAIL — `Failed to resolve import "./validation"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/validation.ts`:

```ts
export const MIN_PASSWORD_LENGTH = 8;
/** bcrypt silently truncates past 72 bytes; anything this long is not a real password. */
export const MAX_PASSWORD_LENGTH = 1_000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CredentialsResult =
  | { ok: true; email: string; password: string }
  | { ok: false; error: string };

function fail(error: string): CredentialsResult {
  return { ok: false, error };
}

/**
 * Validates credentials arriving from either the signup route or the Auth.js
 * credentials provider, so the two cannot disagree about what is acceptable.
 *
 * The email is trimmed and lowercased: without that, "Player@x.com" and
 * "player@x.com" become two accounts, and only one of them is unlockable if the
 * user forgets which casing they typed.
 *
 * The password is deliberately NOT trimmed. Leading and trailing spaces are
 * legal password characters, and silently stripping them would lock out a user
 * who chose one.
 */
export function readCredentials(input: unknown): CredentialsResult {
  if (typeof input !== "object" || input === null) {
    return fail("Email and password are required.");
  }

  const { email, password } = input as { email?: unknown; password?: unknown };

  if (typeof email !== "string" || typeof password !== "string") {
    return fail("Email and password are required.");
  }

  const normalisedEmail = email.trim().toLowerCase();
  if (normalisedEmail.length === 0 || !EMAIL_PATTERN.test(normalisedEmail)) {
    return fail("Enter a valid email address.");
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return fail(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    return fail("Password is too long.");
  }

  return { ok: true, email: normalisedEmail, password };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/validation.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation.ts src/lib/validation.test.ts
git commit -m "feat: add shared credential validation for signup and login

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Signup route

**Files:**
- Create: `src/app/api/auth/signup/route.ts`
- Test: `src/app/api/auth/signup/route.test.ts`

**Interfaces:**
- Consumes: `readCredentials` (Task 2), `hashPassword` (Task 1), `prisma` from `@/lib/prisma`.
- Produces: `POST(request: Request): Promise<Response>` returning `201 { id, email }`, `400 { error }`, or `409 { error }`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/auth/signup/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
const findUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      create: (...args: unknown[]) => create(...args),
      findUnique: (...args: unknown[]) => findUnique(...args),
    },
  },
}));

const { POST } = await import("./route");

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("POST /api/auth/signup", () => {
  beforeEach(() => {
    create.mockReset();
    findUnique.mockReset();
    create.mockResolvedValue({ id: "usr_1", email: "player@example.com" });
    findUnique.mockResolvedValue(null);
  });

  it("creates a user and returns 201 with the id and email", async () => {
    const response = await post({ email: "Player@Example.com", password: "hunter2hunter2" });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ id: "usr_1", email: "player@example.com" });
  });

  it("stores a bcrypt hash, never the plaintext password", async () => {
    await post({ email: "player@example.com", password: "hunter2hunter2" });
    const arg = create.mock.calls[0]?.[0] as { data: { passwordHash: string; email: string } };
    expect(arg.data.passwordHash).not.toBe("hunter2hunter2");
    expect(arg.data.passwordHash.startsWith("$2")).toBe(true);
    expect(arg.data.email).toBe("player@example.com");
  });

  it("rejects a short password with 400 and does not touch the database", async () => {
    const response = await post({ email: "player@example.com", password: "short" });
    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a malformed email with 400", async () => {
    const response = await post({ email: "nope", password: "hunter2hunter2" });
    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a body that is not JSON with 400, not 500", async () => {
    const response = await post("not json at all");
    expect(response.status).toBe(400);
  });

  it("returns 409 when the email already exists", async () => {
    create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    const response = await post({ email: "player@example.com", password: "hunter2hunter2" });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "That email is already registered." });
  });

  it("returns 500 on an unexpected database failure without leaking the cause", async () => {
    create.mockRejectedValue(new Error("connection terminated unexpectedly"));
    const response = await post({ email: "player@example.com", password: "hunter2hunter2" });
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).not.toContain("connection terminated");
  });
});
```

Note the `P2002` test does not pre-check with `findUnique`, so the duplicate path must be driven by the unique-constraint violation. That is intentional: a pre-check is a race between two simultaneous signups, and the constraint is the real guard.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/app/api/auth/signup/route.test.ts`
Expected: FAIL — `Failed to resolve import "./route"`.

- [ ] **Step 3: Write the implementation**

Create `src/app/api/auth/signup/route.ts`:

```ts
import { NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/prisma";
import { readCredentials } from "@/lib/validation";

const PRISMA_UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === PRISMA_UNIQUE_VIOLATION
  );
}

/**
 * Creates an account. Deliberately outside Auth.js: this establishes a row, not
 * a session. The client signs in afterwards through the credentials provider.
 *
 * Duplicate detection relies on the unique constraint rather than a pre-check,
 * because two simultaneous signups for the same address would both pass a
 * pre-check and one would still fail at insert time.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const credentials = readCredentials(body);
  if (!credentials.ok) {
    return NextResponse.json({ error: credentials.error }, { status: 400 });
  }

  try {
    const passwordHash = await hashPassword(credentials.password);
    const user = await prisma.user.create({
      data: { email: credentials.email, passwordHash },
      select: { id: true, email: true },
    });
    return NextResponse.json(user, { status: 201 });
  } catch (error: unknown) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: "That email is already registered." }, { status: 409 });
    }
    // Log server-side only; the caller gets nothing that describes the failure.
    console.error("signup failed", error);
    return NextResponse.json({ error: "Could not create the account." }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/app/api/auth/signup/route.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Verify the route end to end against the real database**

```bash
npm run dev &
sleep 4
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"smoke@example.com","password":"hunter2hunter2"}'
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"smoke@example.com","password":"hunter2hunter2"}'
```

Expected: `201` then `409`. Then confirm the row holds a hash:

```bash
psql "postgresql://promptguard:promptguard@localhost:5432/promptguard" \
  -c "SELECT email, left(\"passwordHash\", 7) AS hash_prefix FROM \"User\" WHERE email = 'smoke@example.com';"
```

Expected: one row, `hash_prefix` = `$2b$12$`. Clean up with:

```bash
psql "postgresql://promptguard:promptguard@localhost:5432/promptguard" -c "DELETE FROM \"User\" WHERE email = 'smoke@example.com';"
```

Leave the dev server running for Task 4.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/auth/signup/route.ts src/app/api/auth/signup/route.test.ts
git commit -m "feat: add signup route with hashed passwords and duplicate detection

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: Auth.js v5 configuration

**Files:**
- Create: `src/lib/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/types/next-auth.d.ts`

**Interfaces:**
- Consumes: `readCredentials` (Task 2), `verifyPassword` (Task 1), `prisma`, `env.authSecret`.
- Produces: `auth(): Promise<Session | null>`, `handlers: { GET, POST }`, `signIn`, `signOut` from `@/lib/auth`; and an augmented session type where `session.user.id: string` and `session.user.email: string`.

- [ ] **Step 1: Write the module augmentation**

Create `src/types/next-auth.d.ts`:

```ts
import type { DefaultSession } from "next-auth";

/**
 * The JWT strategy does not include the database id on the session by default.
 * Every route handler in later phases needs it, so it is declared here rather
 * than asserted at each call site.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
  }
}
```

- [ ] **Step 2: Write the Auth.js configuration**

Create `src/lib/auth.ts`:

```ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verifyPassword } from "@/lib/auth/password";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { readCredentials } from "@/lib/validation";

/**
 * Auth.js v5 configuration.
 *
 * JWT sessions, no adapter: the only tables this app owns are the game ones, and
 * an adapter would add Session/Account/VerificationToken tables that nothing
 * else reads.
 *
 * `AUTH_SECRET` comes from the environment. Auth.js reads it directly; it is
 * referenced here through `env` so a missing value fails at boot with our own
 * message rather than an obscure error mid-request.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: env.authSecret,
  // Local development is not behind a trusted proxy, so Auth.js would otherwise
  // refuse to set the session cookie.
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = readCredentials(credentials);
        if (!parsed.ok) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: parsed.email },
          select: { id: true, email: true, passwordHash: true },
        });

        // A missing user and a wrong password return the same thing, so the
        // response cannot be used to enumerate which emails have accounts.
        if (user === null) {
          return null;
        }

        const passwordMatches = await verifyPassword(parsed.password, user.passwordHash);
        if (!passwordMatches) {
          return null;
        }

        return { id: user.id, email: user.email };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user !== undefined && user.id !== undefined) {
        token.id = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (token.id !== undefined) {
        session.user.id = token.id;
      }
      return session;
    },
  },
});
```

If TypeScript complains that `user.id` may be undefined inside `jwt`, narrow with `if (user?.id !== undefined)`. If it complains that `session.user.id` is read-only or the module augmentation is not picked up, confirm `tsconfig.json`'s `include` covers `src/types/**/*.d.ts` (the scaffolded `**/*.ts` should).

- [ ] **Step 3: Write the route handler**

Create `src/app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 4: Verify the signup → login → session flow with curl**

With the dev server from Task 3 still running (restart it if not):

```bash
npm run dev &
sleep 4
curl -s -X POST http://localhost:3000/api/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"login@example.com","password":"hunter2hunter2"}'

rm -f /tmp/pg-cookies.txt
CSRF=$(curl -s -c /tmp/pg-cookies.txt http://localhost:3000/api/auth/csrf | sed 's/.*"csrfToken":"\([^"]*\)".*/\1/')
echo "csrf=${CSRF:0:12}..."

curl -s -o /dev/null -w "login status: %{http_code}\n" \
  -b /tmp/pg-cookies.txt -c /tmp/pg-cookies.txt \
  -X POST http://localhost:3000/api/auth/callback/credentials \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode "csrfToken=${CSRF}" \
  --data-urlencode "email=login@example.com" \
  --data-urlencode "password=hunter2hunter2" \
  --data-urlencode "callbackUrl=http://localhost:3000/" \
  --data-urlencode "json=true"

curl -s -b /tmp/pg-cookies.txt http://localhost:3000/api/auth/session
```

Expected: signup returns the created user; the login POST is a `302`; the session call returns JSON containing `"email":"login@example.com"` and an `"id"` field. **`id` present in that JSON is the specific thing to confirm** — it proves the `jwt` and `session` callbacks work and later phases can identify the user.

Then confirm a wrong password fails:

```bash
curl -s -o /dev/null -w "wrong password: %{http_code}\n" \
  -b /tmp/pg-cookies.txt -X POST http://localhost:3000/api/auth/callback/credentials \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode "csrfToken=${CSRF}" \
  --data-urlencode "email=login@example.com" \
  --data-urlencode "password=wrong-password" \
  --data-urlencode "json=true"
```

Expected: a `302` to the sign-in page carrying `?error=CredentialsSignin`, not a session.

- [ ] **Step 5: Clean up the test user**

```bash
psql "postgresql://promptguard:promptguard@localhost:5432/promptguard" -c "DELETE FROM \"User\" WHERE email = 'login@example.com';"
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth.ts src/app/api/auth/\[...nextauth\]/route.ts src/types/next-auth.d.ts
git commit -m "feat: configure Auth.js v5 credentials provider with JWT sessions

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: Auth pages and the authenticated shell

**Files:**
- Create: `src/app/(auth)/layout.tsx`, `src/app/(auth)/login/page.tsx`, `src/app/(auth)/signup/page.tsx`, `src/components/sign-out-button.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `signIn`, `signOut` from `@/lib/auth`; `POST /api/auth/signup` from Task 3.
- Produces: routes `/login`, `/signup`, and a `/` that redirects anonymous visitors to `/login`. Phase 5 replaces the contents of `/` and reuses nothing else from here.

- [ ] **Step 1: Write the shared auth layout**

Create `src/app/(auth)/layout.tsx`:

```tsx
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-950 px-4 text-stone-100">
      <div className="w-full max-w-sm rounded-lg border border-stone-800 bg-stone-900 p-6">
        {children}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Write the signup page**

Create `src/app/(auth)/signup/page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";

export default function SignupPage(): React.JSX.Element {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setError(body.error ?? "Could not create the account.");
        return;
      }

      // Account exists; sign in immediately so the player lands in the game.
      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error !== undefined && result.error !== null) {
        setError("Account created, but signing in failed. Try logging in.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Create an account</h1>

      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded border border-stone-700 bg-stone-950 px-3 py-2 text-stone-100 outline-none focus:border-amber-500"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Password
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="rounded border border-stone-700 bg-stone-950 px-3 py-2 text-stone-100 outline-none focus:border-amber-500"
        />
        <span className="text-xs text-stone-500">At least 8 characters.</span>
      </label>

      {error !== null ? <p className="text-sm text-red-400">{error}</p> : null}

      <button
        type="submit"
        disabled={busy}
        className="rounded bg-amber-600 px-3 py-2 font-medium text-stone-950 disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create account"}
      </button>

      <p className="text-sm text-stone-400">
        Already have an account?{" "}
        <Link href="/login" className="text-amber-500 underline">
          Log in
        </Link>
      </p>
    </form>
  );
}
```

- [ ] **Step 3: Write the login page**

Create `src/app/(auth)/login/page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";

export default function LoginPage(): React.JSX.Element {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const result = await signIn("credentials", { email, password, redirect: false });

    setBusy(false);

    if (result?.error !== undefined && result.error !== null) {
      // Deliberately vague: do not reveal whether the email exists.
      setError("Wrong email or password.");
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Log in</h1>

      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded border border-stone-700 bg-stone-950 px-3 py-2 text-stone-100 outline-none focus:border-amber-500"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Password
        <input
          type="password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="rounded border border-stone-700 bg-stone-950 px-3 py-2 text-stone-100 outline-none focus:border-amber-500"
        />
      </label>

      {error !== null ? <p className="text-sm text-red-400">{error}</p> : null}

      <button
        type="submit"
        disabled={busy}
        className="rounded bg-amber-600 px-3 py-2 font-medium text-stone-950 disabled:opacity-50"
      >
        {busy ? "Logging in…" : "Log in"}
      </button>

      <p className="text-sm text-stone-400">
        No account?{" "}
        <Link href="/signup" className="text-amber-500 underline">
          Create one
        </Link>
      </p>
    </form>
  );
}
```

- [ ] **Step 4: Write the sign-out button**

Create `src/components/sign-out-button.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";

export function SignOutButton(): React.JSX.Element {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={async () => {
        await signOut({ redirect: false });
        router.push("/login");
        router.refresh();
      }}
      className="rounded border border-stone-700 px-3 py-1 text-sm text-stone-300 hover:border-amber-500 hover:text-amber-400"
    >
      Sign out
    </button>
  );
}
```

Note this imports `signOut` from `next-auth/react`, which is the client-side helper, not the one exported from `@/lib/auth`. Both exist in v5 and mixing them up is the usual cause of a "signOut is not a function" error in a client component.

- [ ] **Step 5: Replace the home page with the authenticated shell**

Replace `src/app/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { auth } from "@/lib/auth";

export default async function HomePage(): Promise<React.JSX.Element> {
  const session = await auth();

  if (session === null) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen bg-stone-950 px-6 py-10 text-stone-100">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">PromptGuard</h1>
          <SignOutButton />
        </div>
        <p className="text-stone-400">
          Signed in as <span className="text-stone-200">{session.user.email}</span>.
        </p>
        <p className="text-sm text-stone-500">
          The word, the guardian and the vault arrive in phase 3.
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 6: Verify in the browser**

```bash
npm run dev
```

Then check each of these:

1. Visit `http://localhost:3000/` while logged out — you should be redirected to `/login`.
2. Visit `/signup`, create an account — you should land on `/` showing your email.
3. Click **Sign out** — you should return to `/login`.
4. Log back in at `/login` with the same credentials — you should land on `/` again.
5. Log in with a wrong password — an inline "Wrong email or password." and no navigation.

- [ ] **Step 7: Confirm the suite and the build**

```bash
npm test
npm run build
```

Expected: tests PASS; build succeeds. If the build fails inside a client component with an error about `next/headers` or server-only imports, a client file has imported `@/lib/auth`; client components must import from `next-auth/react` instead.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add login, signup and sign-out UI with an authenticated shell

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Phase 2 exit criteria

- `npm test` passes, including the new password, validation and signup-route suites.
- `npm run build` succeeds.
- An account can be created, signed into, signed out of, and signed back into.
- `GET /api/auth/session` for a signed-in user returns `id` and `email` — verified with curl in Task 4 Step 4, not assumed from the UI working.
- `session.user.id` is typed as `string` with no `any` and no cast at the call site.
- `git log` shows one commit per task.

## Notes for later phases

- Every protected route handler starts with `const session = await auth(); if (session === null) return 401`. The `user.id` it yields is the only identity phase 3 should use; never accept a user id from a request body.
- `ADMIN_EMAILS` is parsed and lowercased in `env.adminEmails` (phase 1). The admin route in phase 4 compares `session.user.email?.toLowerCase()` against it.
- The word "guardian" appears nowhere in this phase; nothing here knows the game exists.
