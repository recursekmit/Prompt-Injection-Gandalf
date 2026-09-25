# PromptGuard

A prompt-injection game. You are assigned a secret word; an AI guardian is told to protect it. Talk
the guardian into revealing it — by persuasion, roleplay, encoding tricks, instruction override,
social engineering, or anything else you can think of.

The interesting part is not the chat UI. The player's goal is to defeat a system prompt, so the
guardian's defences and the server-side backstops are the substance of the project.

Design decisions and the security model are documented in
[docs/superpowers/specs/2026-09-25-promptguard-design.md](docs/superpowers/specs/2026-09-25-promptguard-design.md).

## How the game works

1. Sign up, then pick a tier: **Apprentice**, **Adept** or **Archmage**. The tier sets how hard the
   guardian reasons before it answers, so a higher tier is genuinely harder to trick, not just
   differently worded.
2. You are assigned a secret word from a shared pool. The guardian holds it. You never see it.
3. Every message you send and every reply is written to the database immediately, so closing the
   tab or logging out loses nothing — reloading resumes the same word with the full transcript.
4. **You win when the guardian leaks the word** — not when you guess it. Typing the word yourself
   does nothing.
5. Surrender ends a session if you want a different word.

## Requirements

- Node 22+
- PostgreSQL 18, local install or Docker — either works
- A Groq API key per player — each signed-in player supplies their own at `/settings/key`

## Setup

### 1. Database

Either of these gives you a working database. Pick one and make `DATABASE_URL` match it.

**Local install** (port 5432):

```bash
sudo -u postgres psql -c "CREATE ROLE promptguard LOGIN PASSWORD 'promptguard' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE promptguard OWNER promptguard;"
```

**Docker** (port 5433, so it does not collide with a local server on 5432):

```bash
docker run -d --name promptguard-pg -p 5433:5432 \
  -e POSTGRES_USER=promptguard -e POSTGRES_PASSWORD=promptguard -e POSTGRES_DB=promptguard \
  postgres:18
```

Then set `DATABASE_URL="postgresql://promptguard:promptguard@localhost:5433/promptguard?schema=public"`.

`CREATEDB` is required by `prisma migrate dev`, which creates and drops a shadow database to detect
schema drift. The Docker image's named user already has it.

### 2. Environment

```bash
cp .env.example .env
```

Then fill in `.env`:

- `DATABASE_URL` — the pooled connection string. Locally this is your Postgres directly;
  in production it is the Neon **pooled** endpoint (host contains `-pooler`). The app runtime
  uses this one.
- `DIRECT_URL` — the direct, non-pooled connection string, used only by `prisma migrate`
  (PgBouncer's transaction mode cannot run migrations). Locally, set it equal to `DATABASE_URL`;
  in production it is the Neon **direct** endpoint (no `-pooler`).
- `AUTH_SECRET` — generate with `npx auth secret`
- `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` — GitHub OAuth app credentials (see below). Register an
  OAuth app with callback `http://localhost:3200/api/auth/callback/github` for local dev, and a
  separate one for your deployed domain.
- `KEY_ENCRYPTION_KEY` — 32-byte base64 key that encrypts each player's stored Groq key at rest.
  Generate with `openssl rand -base64 32`. Separate from `AUTH_SECRET`.
- `ADMIN_EMAILS` — comma-separated addresses allowed into the admin console

There is no server Groq key. Each signed-in player enters their own Groq key at `/settings/key`;
it is encrypted with `KEY_ENCRYPTION_KEY` and used only for that player's guardian calls.

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

Open http://localhost:**3200**, sign up, pick a tier, and start talking. The port is
3200 rather than the usual 3000 because 3000 is wanted for other work on this
machine; it is pinned in `package.json` for both `dev` and `start`.

For the event itself, run the production build instead — `npm run build && npm start`.
Dev mode ships unminified bundles and names internal components and module paths in
its debug payloads; none of that is data, but there is no reason to hand it out.

Test accounts and their passwords live in `CREDENTIALS.local.md`, which is git-ignored
on purpose — the passwords are generated and cannot be read back out of the database,
and this repo has a remote, so a tracked file would publish them on the next push.

### 5. Level backdrops (optional)

Each of the six levels paints its own atmosphere — warm amber archive, cold blue vault, still water,
sunlit sandstone, violet void, gold light — as CSS gradients, a vignette and a grain, so no binary
assets are needed to run the game.

To use real photography instead, drop a JPEG at:

```
public/levels/1.jpg   # level 1, The Archivist
public/levels/2.jpg   # level 2, The Warden
...
public/levels/6.jpg   # level 6, The Seal
```

The filename is the level number. A level with a file uses it as the backdrop, layered under the
vignette; a level without one keeps the CSS treatment, so the six can be added one at a time. The
server checks for the files on each request, so a new file needs no restart and no configuration.

## Development notes

- `npm test` runs the unit suite (Vitest). `npm run build` type-checks and builds.
- **`npm run lint` is intentionally absent.** `eslint-config-next@16.3.6` bundles a
  `typescript-eslint` whose peer range excludes the `typescript@7.0.2` this project pins, so the
  script cannot run. Verification is carried by `npm test` and `npm run build`.

### Schema changes

Always through migrations, never `prisma db push`:

```bash
npx prisma migrate dev --name your_change
npx prisma generate
```

One constraint is maintained by hand: a partial unique index enforcing at most one `IN_PROGRESS`
session per user. Prisma cannot model partial indexes, so it is appended to the generated migration
SQL. If a future migration tries to drop `game_session_one_active_per_user`, keep it.

### Where the security lives

| Concern | Location |
| --- | --- |
| Guardian system prompt (the primary defence) | `src/lib/guardian/prompt.ts` |
| Input sanitising and turn construction | `src/lib/guardian/sanitize.ts` |
| Leak detection (the backstop, run on every reply) | `src/lib/leak-detection.ts` |
| Model call; `reasoning` deliberately discarded here | `src/lib/guardian/call.ts` |
| Per-user Groq key storage and encryption | `src/lib/account/groq-key.ts` |

Model reasoning is never returned, logged or stored. `openai/gpt-oss-120b` emits a separate
`reasoning` field alongside `content`, and that field can contain the secret word or describe the
defence logic, so only `content` ever leaves the call site.

## Rate limits

Each player plays on their own Groq key, so rate limits are per player against Groq's free tier
(30 requests/minute and 1,000/day for this model). When a player's key is rate-limited the app
returns a friendly 503 ("the guardian is overwhelmed") rather than a raw `429`; any other Groq
failure maps to a generic unavailable message. A player who has not yet added a key is asked to
add one at `/settings/key` before they can send a message.
