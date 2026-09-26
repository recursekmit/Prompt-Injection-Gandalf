import { existsSync } from "node:fs";
import { join } from "node:path";

import type { LevelArtwork, LevelNumber } from "@/lib/types";

/**
 * The optional photographic backdrop for each level.
 *
 * The owner's design uses photographic backdrops that are not in the
 * repository, so a level's art is a slot rather than a fact: drop a JPEG at
 * `public/levels/<n>.jpg` (n = 1–3, matching the level number) and it is picked
 * up on the next request. Nothing else has to change — the CSS treatment in
 * `globals.css` is the fallback for any level without a file, and for all three
 * when the directory does not exist at all.
 *
 * This is a server module: it touches the filesystem, so it must not be imported
 * by a client component. The page reads it and passes plain URLs down.
 */

const LEVEL_NUMBERS: readonly LevelNumber[] = [1, 2, 3];

export function readLevelArtwork(): LevelArtwork {
  const artwork: Partial<Record<LevelNumber, string>> = {};
  for (const level of LEVEL_NUMBERS) {
    const file = join(process.cwd(), "public", "levels", `${level}.jpg`);
    if (existsSync(file)) {
      artwork[level] = `/levels/${level}.jpg`;
    }
  }
  return artwork;
}
