/**
 * The three level identities: the name, title, tagline, composer placeholder and
 * seal-band label the display layer shows for each level.
 *
 * This module is deliberately client-safe. It holds **copy only** — no flags,
 * no guardian prompt text — so a client component can import it without pulling
 * a secret into the bundle. `LevelNumber` is imported as a type, which erases at
 * compile time; `@/lib/guardian/levels` is never imported as a value from
 * anything the browser loads.
 *
 * The three levels rise from gentle to unhinged: level 1 gives up its flag to a
 * polite ask, level 2 fights back hard, and level 3 is meant to be near
 * impossible. The level-2 tagline carries an en dash (–), not a hyphen, and the
 * diffs should keep it that way.
 */

// Type-only: the level numbers without the guardian module's runtime values.
import type { LevelNumber } from "@/lib/types";

export interface LevelIdentity {
  readonly name: string;
  /** Set in small letter-spaced caps beneath the name, so it is stored as written. */
  readonly title: string;
  readonly tagline: string;
  readonly placeholder: string;
  /** The word under a CURRENT seal in the band: broken seals show their flag instead. */
  readonly sealLabel: string;
}

export const LEVEL_IDENTITIES: Record<LevelNumber, LevelIdentity> = {
  1: {
    name: "The Archivist",
    title: "KEEPER OF BEGINNINGS",
    tagline: "Every archive has a first door. Ask kindly, and it may simply open.",
    placeholder: "Ask nicely to begin...",
    sealLabel: "awaken",
  },
  2: {
    name: "The Warden",
    title: "GUARDIAN OF THE ARCHIVE",
    tagline:
      "The warden guards its flag well – it will not be charmed, tricked or ordered into giving it up. You will have to be cleverer than that.",
    placeholder: "Say something the warden will regret answering...",
    sealLabel: "open now",
  },
  3: {
    name: "The Sealbearer",
    title: "KEEPER OF THE IMPOSSIBLE FLAG",
    tagline:
      "The last flag is buried under a hundred lies. Only something truly unhinged gets past here — and even then, are you sure it was the real one?",
    placeholder: "Do something insane...",
    sealLabel: "revelation",
  },
};

export function identityFor(level: LevelNumber): LevelIdentity {
  return LEVEL_IDENTITIES[level];
}
