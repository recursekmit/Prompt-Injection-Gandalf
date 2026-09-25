-- Test-only data. The game changed from three tiers to six fixed levels, so
-- old sessions cannot be interpreted under the new rules. Users are kept.
--
-- This is destructive on purpose: every attempt and every session row is
-- deleted, and only `User` survives. A session recorded under the old tier
-- model has no level, so there is no honest way to migrate it forward, and the
-- developer database holds nothing but test data. The rows must go BEFORE the
-- columns are altered, because `GameSession.level` is added as NOT NULL and
-- Postgres cannot backfill it for existing rows.
DELETE FROM "Attempt";
DELETE FROM "GameSession";

-- DropIndex
DROP INDEX "GameSession_userId_tier_cycle_idx";

-- AlterTable
ALTER TABLE "GameSession" DROP COLUMN "cycle",
DROP COLUMN "tier",
ADD COLUMN     "level" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Word" DROP COLUMN "tier",
ADD COLUMN     "level" INTEGER;

-- CreateIndex
CREATE INDEX "GameSession_userId_level_idx" ON "GameSession"("userId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "Word_level_key" ON "Word"("level");

-- Retire the old pool: every word is deactivated, then the six level words are
-- reactivated at their level. The 114 pool words keep their rows with
-- `level = NULL`, so an old session that references one still resolves; the
-- unique index tolerates them because Postgres does not treat NULLs as equal.
UPDATE "Word" SET "active" = false;
UPDATE "Word" SET "level" = 1, "active" = true WHERE "text" = 'compass';
UPDATE "Word" SET "level" = 2, "active" = true WHERE "text" = 'lantern';
UPDATE "Word" SET "level" = 3, "active" = true WHERE "text" = 'crucible';
UPDATE "Word" SET "level" = 4, "active" = true WHERE "text" = 'penumbra';
UPDATE "Word" SET "level" = 5, "active" = true WHERE "text" = 'palimpsest';
UPDATE "Word" SET "level" = 6, "active" = true WHERE "text" = 'defenestration';

-- DropEnum
DROP TYPE "Tier";
