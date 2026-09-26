# PromptGuard — UI Revamp + Name/Roll Onboarding

**Date:** 2026-09-25
**Branch:** `feat/oauth-per-user-keys`
**Goal:** Port beat-the-bot's acid-green cyber aesthetic onto PromptGuard, add a
public marketing landing + public leaderboard (no PII), and collect name +
roll number at registration. No rewards anywhere.

## Binding constraints (do not break)

- Repo is public: no persona, seal, or answer word in tracked source. They stay
  in the `GUARDIAN_LEVELS` env secret. Never write real secrets into git.
- Public leaderboard MUST NOT expose email (PII) — not rendered *and* not in the
  JSON payload. Show name + roll number instead.
- Guardian `reasoning` is never read/logged/returned/stored. Decrypted Groq keys
  never logged/returned.
- The partial unique index `game_session_one_active_per_user` is never dropped.
- Migration is additive only; existing users must survive it.

## Aesthetic

Adopt beat-the-bot's design system, reimplemented in our Tailwind v4 stack
(beat-the-bot uses plain CSS + inline styles — a verbatim copy would fight our
stack, so we port tokens + utility classes into `globals.css`).

Palette (into `globals.css`): bg `#050607`, surfaces `#090b0d`/`#0d0f12`, accent
acid-green `#9efe00` (bright `#adff00`, glow `#84e800`), borders `#1a1e23`, muted
text `#9aa0a6`/`#5f6368`, error red `rgba(239,68,68,x)` / text `#fca5a5`. Mono
terminal labels (Geist Mono), sharp 2–4px radii, green glow shadows, constellation
grid body background (two green radial gradients + 80px white grid).

Utility classes to add: `.btn-recurse-primary`, `.btn-recurse-secondary`,
`.recurse-card`, `.recurse-card-glow`, `.input-field`, `.status-beacon`,
`.terminal-tag`, `.outline-text`.

**Scope of re-skin:** chrome (header/footer), landing, public leaderboard, auth
pages, dashboard, and the game shell adopt the acid-green system. The six
per-level `.level-arena[data-level]` moods stay as-is — they are the game's
internal atmosphere and read fine on black. `ponytail:` re-skinning all six
arenas is out of scope unless asked.

## Routing

Public (no auth): `/` (landing), `/leaderboard`, `/login`, `/signup`.
Auth-gated: `/challenges` (the game, moved from `/`), `/dashboard`,
`/settings/key`, `/onboarding`.

Gate order for a signed-in user hitting `/challenges`:
1. no session → `/login`
2. name or rollNumber missing → `/onboarding`
3. no Groq key → `/settings/key`
4. else render game.

Post-login/-signup redirect target: `/challenges`.

## Data model

`prisma/schema.prisma` — add to `User`:
```prisma
name       String?
rollNumber String? @unique
```
Nullable because existing users predate the fields; roll `@unique` allows many
NULLs in Postgres. Onboarding gate enforces presence at the app layer. Migration
via `prisma migrate dev --name add_user_name_roll`, then `prisma generate`.

## Validation (`src/lib/validation.ts`)

```
ROLL_NUMBER = /^2[A-Z0-9]BD[A-Z0-9]A0[A-Z0-9]{3}$/   // 10 chars, e.g. 21BD1A0501
```
- `readRollNumber(input)` → trims + uppercases, tests regex.
- `readProfile(input)` → { name (trimmed, 1..80 chars), rollNumber } result union.
- Signup parsing composes `readCredentials` + `readProfile`.

## Onboarding

- `/onboarding` (client): name + roll form. GitHub users get name prefilled from
  session (editable). `POST /api/account/profile` validates + persists; P2002 on
  rollNumber → "That roll number is already registered." Redirects to next gate.
- Gate helper reads `user.name`/`user.rollNumber`; missing → `/onboarding`.

## Public leaderboard

- Extend `RankPlayer` + `LeaderboardRow` (`ranking.ts`, `types.ts`) with
  `name: string | null`, `rollNumber: string | null`. `loadLeaderboard` selects
  them. Email stays on the row for the admin board + tiebreak only.
- New public loader maps rows to `PublicLeaderboardRow` **without email**:
  `{ rank, name, rollNumber, levelsCompleted, totalAttempts, lastWinAt, levels }`.
  Display fallback when name null (legacy rows): show roll, else "Unknown".
- `/leaderboard` (public server page): table — rank, participant (name + roll),
  per-level solved ticks, levels-completed count. No rewards column. No polling
  (SSR; refresh-on-load is enough — `ponytail:` add polling only if asked).

## Rewards

None of beat-the-bot's prize copy / `/prizes` route / rewards columns are ported.
Constraint, not a deletion.

## Tasks

1. Schema + migration + generate (name, rollNumber).
2. Validation: ROLL_NUMBER, readRollNumber, readProfile (+ tests).
3. Signup route + form collect name/roll; P2002 disambiguation.
4. Onboarding page + `POST /api/account/profile` + gate helper.
5. Theme port into `globals.css`; fix `layout.tsx` metadata.
6. Public-aware header/nav (+ footer) in the new theme.
7. Landing `/` (hero, what-is-injection, how-it-works, FAQ incl. API-key safety, CTA).
8. Move game to `/challenges`; rewire internal links + post-auth redirects + gate.
9. Public leaderboard data (row fields, public mapping) + `/leaderboard` page.
10. Re-skin auth + dashboard to the new theme.
11. Verify (`npm test` + `npm run build`); commit (no push, no `.env`).

## Verification

`npm test` (Vitest) green, `npm run build` clean. Manual: logged-out sees
landing + leaderboard; logged-in without name/roll routed to `/onboarding`;
public leaderboard payload carries no email.
