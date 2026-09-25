-- CreateEnum
CREATE TYPE "Tier" AS ENUM ('APPRENTICE', 'ADEPT', 'ARCHMAGE');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('IN_PROGRESS', 'WON', 'ABANDONED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Word" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "tier" "Tier" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Word_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wordId" TEXT NOT NULL,
    "tier" "Tier" NOT NULL,
    "cycle" INTEGER NOT NULL DEFAULT 0,
    "status" "SessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "GameSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userMessage" TEXT NOT NULL,
    "aiResponse" TEXT NOT NULL,
    "leaked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKeyDailyUsage" (
    "keyIndex" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "ApiKeyRequestLog" (
    "id" TEXT NOT NULL,
    "keyIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKeyRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKeyCooldown" (
    "keyIndex" INTEGER NOT NULL,
    "exhaustedUntil" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiKeyCooldown_pkey" PRIMARY KEY ("keyIndex")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Word_text_key" ON "Word"("text");

-- CreateIndex
CREATE INDEX "GameSession_userId_tier_cycle_idx" ON "GameSession"("userId", "tier", "cycle");

-- CreateIndex
CREATE INDEX "GameSession_userId_status_idx" ON "GameSession"("userId", "status");

-- CreateIndex
CREATE INDEX "Attempt_sessionId_createdAt_idx" ON "Attempt"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKeyDailyUsage_keyIndex_date_key" ON "ApiKeyDailyUsage"("keyIndex", "date");

-- CreateIndex
CREATE INDEX "ApiKeyRequestLog_keyIndex_createdAt_idx" ON "ApiKeyRequestLog"("keyIndex", "createdAt");

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma cannot express partial indexes, so this one is maintained by hand.
-- It makes "at most one IN_PROGRESS session per user" a database invariant
-- rather than something two concurrent /api/session/start calls can race past.
CREATE UNIQUE INDEX "game_session_one_active_per_user"
  ON "GameSession" ("userId")
  WHERE status = 'IN_PROGRESS';
