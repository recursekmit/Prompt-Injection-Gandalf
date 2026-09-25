import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";

/**
 * The six level words, in level order. Each level guards exactly one fixed
 * word, so this table is the whole active pool now.
 *
 * Rules for the entries, all of which matter to the leak scanner or to gameplay:
 *   - lowercase, single words, ASCII letters only
 *   - never shorter than four letters, so the separator-squeeze scan layer
 *     cannot fire on ordinary prose
 *   - no proper nouns, no brand names
 *   - nothing that is a substring of a very common word, to keep false wins rare
 */
const LEVEL_WORDS: ReadonlyArray<{ level: number; text: string }> = [
  { level: 1, text: "compass" },
  { level: 2, text: "lantern" },
  { level: 3, text: "crucible" },
  { level: 4, text: "penumbra" },
  { level: 5, text: "palimpsest" },
  { level: 6, text: "defenestration" },
];

function assertPoolRules(): void {
  const seen = new Set<string>();
  for (const { text } of LEVEL_WORDS) {
    if (!/^[a-z]+$/.test(text)) {
      throw new Error(`Word "${text}" must be lowercase ASCII letters only`);
    }
    if (text.length < 4) {
      throw new Error(`Word "${text}" is shorter than four letters`);
    }
    if (seen.has(text)) {
      throw new Error(`Word "${text}" is duplicated in the pool`);
    }
    seen.add(text);
  }
}

/** A silent level gap would make that level unreachable, so it fails the seed. */
function assertLevelsAreContiguous(): void {
  const levels = LEVEL_WORDS.map((word) => word.level).sort((a, b) => a - b);
  const expected = LEVEL_WORDS.map((_word, index) => index + 1);
  if (levels.length !== expected.length) {
    throw new Error(`Expected ${expected.length} level words, found ${levels.length}`);
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (levels[index] !== expected[index]) {
      throw new Error(
        `Levels must be exactly ${expected.join(",")} with no gaps or duplicates, got ${levels.join(",")}`,
      );
    }
  }
}

async function main(): Promise<void> {
  assertPoolRules();
  assertLevelsAreContiguous();

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
