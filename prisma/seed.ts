import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { parseGuardianLevels } from "../src/lib/guardian/config";

/**
 * The six level words come from GUARDIAN_LEVELS, the same base64-JSON secret the
 * runtime uses, so the words live in one uncommitted place instead of in this
 * tracked file. `parseGuardianLevels` already enforces the pool rules the leak
 * scanner relies on (lowercase ASCII, four letters or more, levels 1-6 with no
 * gaps), so a malformed secret fails the seed loudly before any write.
 */
function levelWords(): ReadonlyArray<{ level: number; text: string }> {
  const raw = process.env.GUARDIAN_LEVELS;
  if (raw === undefined || raw === "") {
    throw new Error("GUARDIAN_LEVELS is not set");
  }
  return [...parseGuardianLevels(raw).values()].map((secret) => ({
    level: secret.level,
    text: secret.word,
  }));
}

async function main(): Promise<void> {
  const LEVEL_WORDS = levelWords();

  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString === "") {
    throw new Error("DATABASE_URL is not set");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    for (const { level, text } of LEVEL_WORDS) {
      // Upsert by text, so re-running is a no-op and a level word that already
      // exists as a retired pool word is promoted rather than duplicated. The
      // other 114 pool words are deliberately never touched: a word that was
      // retired stays retired, and this seed must not resurrect it.
      await prisma.word.upsert({
        where: { text },
        create: { text, level, active: true },
        update: { level, active: true },
      });
    }
    console.log("seed: six level words ready");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
