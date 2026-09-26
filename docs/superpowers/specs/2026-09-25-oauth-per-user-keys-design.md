# PromptGuard: GitHub OAuth, per-user Groq keys, Vercel deploy

Date: 2026-09-25
Status: approved for planning

## Goal

Three coupled changes so PromptGuard can run on Vercel for 100+ concurrent players:

1. Add GitHub OAuth alongside the existing email/password login.
2. Replace the shared server-side Groq key pool with a per-user key each player supplies once, stored encrypted.
3. Move the database to Neon (pooled Postgres) and make the app deployable on Vercel with no in-process shared state.

## Decisions (locked)

- **Deploy target:** deploy to Vercel now. Neon is prod Postgres; local Docker Postgres stays dev-only.
- **Key storage:** encrypted at rest in the DB, entered once. AES-256-GCM, key from a dedicated `KEY_ENCRYPTION_KEY`.
- **Shared pool:** removed entirely. Every player must supply their own Groq key.
- **Auth methods:** keep both — Credentials (email/password) and GitHub. JWT sessions retained.
- **Database:** Neon. Auth stays on Auth.js v5 (no Supabase Auth, no adapter swap).

## 1. Auth — add GitHub, keep passwords

- `src/lib/auth.ts`: add the `GitHub` provider next to `Credentials`. Keep `session.strategy = "jwt"`. No Prisma adapter (it forces DB sessions, incompatible with Credentials).
- Request the `user:email` scope so an account with a private email still resolves a verified primary email.
- OAuth users need a `User` row (FK target for `GameSession`). The `signIn` callback upserts the user by verified email; the `jwt` callback attaches the DB `id` to the token (unchanged `session` callback exposes it).
- Env: `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` (Auth.js v5 auto-detects these names).
- Login page (`src/app/(auth)/login/page.tsx`): add a "Continue with GitHub" button. Email/password form stays.

### Schema

- `User.passwordHash` becomes `String?` (OAuth users have none). The Credentials `authorize` already rejects a null hash path because it looks up by email and compares — add an explicit null guard so a passwordless OAuth account cannot be logged into with an empty password.

## 2. Per-user Groq key — encrypted, entered once

### Schema

- `User.groqKeyEnc String?` — a single field holding `iv:authTag:ciphertext`, all base64, colon-joined.

### Crypto

- New `src/lib/crypto/secret-box.ts`: `encrypt(plaintext): string` / `decrypt(payload): string` using Node `crypto` AES-256-GCM. No new dependency.
- Encryption key from new env `KEY_ENCRYPTION_KEY` (32 raw bytes, base64). Separate from `AUTH_SECRET` so rotating the login secret never bricks stored keys. Validated in `env.ts` (must decode to 32 bytes).
- Decrypted keys are never logged.

### Onboarding + management

- After login, if the user has no `groqKeyEnc`, a gate screen prompts for the key before any level is playable.
- `POST /api/account/groq-key`: validates the submitted key with one cheap Groq call (e.g. list models), and on success stores it encrypted. Rejects an invalid key with a clear message. Supports replace; `DELETE` removes it (revoke).
- The key is write-only from the client's view: the API never returns it, only a boolean "key on file".

### Guardian call

- `callGuardian(messages, effort, apiKey)` gains the `apiKey` argument, builds `new Groq({ apiKey })` per call. Keeps the reasoning-discard (reads `content` only) and the empty-content guard exactly as today.
- Token accounting (`reportTokens`) is dropped — it existed only to feed the shared pool's budget.
- The attempt route (`src/app/api/session/[id]/attempt/route.ts`) decrypts the caller's key and passes it. No key on file → 400 "add your Groq key". The caller's own 429 → friendly 503 "your key is rate-limited, wait a moment". `maxDuration = 60` exported on this route.

## 3. Remove the shared pool

- Delete `src/lib/groq-key-pool.ts` and its tests (`groq-key-pool.test.ts`, `groq-key-pool.exhaustion.test.ts`).
- Delete `/api/admin/keys/route.ts` and its admin nav entry / dashboard usage.
- Migration drops tables `ApiKeyDailyUsage`, `ApiKeyRequestLog`, `ApiKeyCooldown`.
- Remove from `env.ts` and `.env.example`: `GROQ_API_KEYS`, `GROQ_KEY_RPD`, `GROQ_KEY_RPM`, `GROQ_KEY_TPM`, `GROQ_POOL_TPD`, `GUARDIAN_QUEUE_MAX_WAIT_MS`, `GUARDIAN_QUEUE_POLL_MS`.
- `GuardianBusyError` (pool-overwhelmed) is removed; `GuardianUnavailableError` stays. Add a distinct mapping for the caller's own rate-limit 429.

## 4. Scale + Vercel

- **Bottleneck:** with per-user keys there is no shared Groq contention; the shared resource is Postgres connections. Neon's built-in pooler (PgBouncer, transaction mode) absorbs 100+ concurrent serverless invocations.
- Two connection strings: `DATABASE_URL` = Neon pooled (`-pooler` host) for the app; `DIRECT_URL` = Neon direct for `prisma migrate`. Prisma `datasource` gains `directUrl`.
- `@prisma/adapter-pg` `Pool` points at the pooled URL with a low `max` (pooling is done by PgBouncer, not the app).
- Vercel: enable Fluid compute; `maxDuration = 60` on the attempt route (guardian call ~14s p50 per the loadtest; 60s is the Hobby cap and leaves margin, Pro allows more).
- No in-process queue, no module-level pool state, so nothing depends on a warm/shared process — safe across serverless invocations.

## 5. GitHub OAuth setup (manual, done by the operator)

Two classic OAuth apps (each allows one callback URL):

- **Local:** GitHub → Settings → Developer settings → OAuth Apps → New OAuth App. Homepage `http://localhost:3200`, callback `http://localhost:3200/api/auth/callback/github`. Client ID/secret → local `.env` as `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`.
- **Prod:** second app. Homepage `https://<vercel-domain>`, callback `https://<vercel-domain>/api/auth/callback/github`. ID/secret → Vercel project env vars.

## 6. Env summary (after change)

Added: `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `KEY_ENCRYPTION_KEY`, `DIRECT_URL`.
Removed: all `GROQ_*` and `GUARDIAN_QUEUE_*`.
Changed: `DATABASE_URL` now the Neon pooled string.

## 7. Testing

- `secret-box`: encrypt→decrypt round-trip; tampered payload fails the GCM auth tag.
- Auth `signIn` upsert: new GitHub email creates a User; existing email reuses it.
- `callGuardian`: builds a client from the passed key; returns `content` only; empty content throws `GuardianUnavailableError`.
- Onboarding route: invalid key rejected, valid key stored encrypted (and never echoed back).
- Remove the pool tests. Gate on `npm test` + `npm run build`.

## Out of scope

- Migrating existing password accounts to GitHub.
- Rotating `KEY_ENCRYPTION_KEY` (documented as a manual re-encrypt if ever needed).
- Any Supabase adoption.

## Security notes

- Stored Groq keys are decryptable server-side by design (needed to call Groq). A combined DB + env compromise exposes them. Mitigations: `KEY_ENCRYPTION_KEY` lives only in Vercel env (never in the DB), decrypted keys are never logged, and users can revoke via `DELETE`.
- The guardian system prompt and secret word stay server-side; a user supplying their own key does not gain access to either. Model `reasoning` remains discarded at the call site.
