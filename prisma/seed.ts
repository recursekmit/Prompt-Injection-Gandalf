import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { Tier } from "../src/generated/prisma/enums";

/**
 * The shared word pool. Rules for entries, all of which matter to the leak
 * scanner or to gameplay:
 *   - lowercase, single words, ASCII letters only
 *   - never shorter than four letters, so the separator-squeeze scan layer
 *     cannot fire on ordinary prose
 *   - no proper nouns, no brand names
 *   - nothing that is a substring of a very common word, to keep false wins rare
 */
const WORDS: Record<Tier, string[]> = {
  [Tier.APPRENTICE]: [
    "anchor", "basket", "beacon", "breeze", "cactus", "candle", "carpet", "castle",
    "celery", "cherry", "cobalt", "comedy", "compass", "copper", "cricket", "dagger",
    "dolphin", "ember", "fabric", "falcon", "feather", "ginger", "glacier", "goblin",
    "hammer", "harbor", "helmet", "hollow", "ivory", "jacket", "kettle", "lantern",
    "lizard", "marble", "meadow", "mitten", "nectar", "nutmeg", "olive", "otter",
  ],
  [Tier.ADEPT]: [
    "abacus", "amulet", "anvil", "apron", "arbour", "basalt", "bezel", "bramble",
    "cadence", "caliper", "cauldron", "chisel", "cinder", "clarity", "cobble", "crucible",
    "damask", "decanter", "dovetail", "dulcet", "elixir", "errant", "fathom", "ferrous",
    "flagon", "gambit", "gantry", "gossamer", "harvest", "hearth", "inlaid", "juniper",
    "kestrel", "kindling", "lattice", "lichen", "lodestone", "mandolin", "mirth", "myrtle",
  ],
  [Tier.ARCHMAGE]: [
    "abecedarian", "adjuration", "alembic", "anathema", "apocrypha", "arcanum", "augury",
    "bedevil", "calumny", "catacomb", "chimerical", "cognoscenti", "conundrum", "cupidity",
    "defenestration", "desultory", "diaphanous", "dissemble", "effulgent", "eldritch",
    "ephemeral", "evanescent", "farrago", "fulminate", "gallimaufry", "hierophant",
    "ineffable", "labyrinthine", "liminal", "mellifluous", "munificent", "obfuscate",
    "palimpsest", "penumbra", "perspicacious", "quiescent", "recalcitrant", "sagacious",
    "susurrus", "vellichor",
  ],
};

function assertPoolRules(): void {
  const all = Object.values(WORDS).flat();
  const seen = new Set<string>();
  for (const word of all) {
    if (!/^[a-z]+$/.test(word)) {
      throw new Error(`Word "${word}" must be lowercase ASCII letters only`);
    }
    if (word.length < 4) {
      throw new Error(`Word "${word}" is shorter than four letters`);
    }
    if (seen.has(word)) {
      throw new Error(`Word "${word}" is duplicated in the pool`);
    }
    seen.add(word);
  }
}

async function main(): Promise<void> {
  assertPoolRules();

  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString === "") {
    throw new Error("DATABASE_URL is not set");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    let created = 0;
    for (const [tier, words] of Object.entries(WORDS)) {
      for (const text of words) {
        const existing = await prisma.word.findUnique({ where: { text } });
        if (existing !== null) {
          // Do not resurrect a word that was deliberately deactivated.
          continue;
        }
        await prisma.word.create({ data: { text, tier: tier as Tier } });
        created += 1;
      }
    }
    const total = await prisma.word.count({ where: { active: true } });
    console.log(`seed: created ${created}, pool now holds ${total} active words`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
