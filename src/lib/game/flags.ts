import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { LevelNumber } from "@/lib/guardian/levels";

/**
 * Per-user, per-level flags.
 *
 * The prize a won session reveals is a `BTB{uuid}` string that is unique to the
 * player and stable across replays: generated on the first play of a level and
 * reused ever after, so a captured flag stays that player's and no two players
 * share one. This is what "flags are different for each user" means, and what
 * lets the guardian's decoys work — a fake `BTB{...}` carries a different body,
 * so it can never collide with the one real flag the win check looks for.
 */

/** `BTB{` + a v4 UUID + `}`. */
function newFlagValue(): string {
  return `BTB{${randomUUID()}}`;
}

/**
 * The player's flag for a level, creating it on first play and returning the
 * existing one thereafter. Concurrency-safe: two racing first-plays both aim at
 * the `@@unique([userId, level])` constraint, so the loser reads back the row
 * the winner created rather than producing a second flag.
 */
export async function getOrCreateFlag(
  userId: string,
  level: LevelNumber,
): Promise<{ id: string; value: string }> {
  const existing = await prisma.flag.findUnique({
    where: { userId_level: { userId, level } },
    select: { id: true, value: true },
  });
  if (existing !== null) {
    return existing;
  }

  try {
    const created = await prisma.flag.create({
      data: { userId, level, value: newFlagValue() },
      select: { id: true, value: true },
    });
    return created;
  } catch {
    // A racing first-play won the unique constraint; its row is the answer.
    const raced = await prisma.flag.findUnique({
      where: { userId_level: { userId, level } },
      select: { id: true, value: true },
    });
    if (raced !== null) {
      return raced;
    }
    throw new Error(`Could not assign a flag for level ${level}`);
  }
}
