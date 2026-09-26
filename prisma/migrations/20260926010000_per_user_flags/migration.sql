-- Per-user flags. Additive: new Flag table, a nullable flagId on GameSession,
-- and wordId relaxed to nullable so flag-era sessions need no Word row. No
-- existing column is dropped and the partial unique index on GameSession is
-- untouched.

-- CreateTable
CREATE TABLE "Flag" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Flag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Flag_value_key" ON "Flag"("value");

-- CreateIndex
CREATE UNIQUE INDEX "Flag_userId_level_key" ON "Flag"("userId", "level");

-- AddForeignKey
ALTER TABLE "Flag" ADD CONSTRAINT "Flag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: relax the legacy word link and add the per-user flag link
ALTER TABLE "GameSession" ALTER COLUMN "wordId" DROP NOT NULL;
ALTER TABLE "GameSession" ADD COLUMN "flagId" TEXT;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_flagId_fkey" FOREIGN KEY ("flagId") REFERENCES "Flag"("id") ON DELETE SET NULL ON UPDATE CASCADE;
