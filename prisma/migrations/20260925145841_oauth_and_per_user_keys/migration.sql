/*
  Warnings:

  - You are about to drop the `ApiKeyCooldown` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ApiKeyDailyUsage` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ApiKeyRequestLog` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "groqKeyEnc" TEXT,
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- DropTable
DROP TABLE "ApiKeyCooldown";

-- DropTable
DROP TABLE "ApiKeyDailyUsage";

-- DropTable
DROP TABLE "ApiKeyRequestLog";
