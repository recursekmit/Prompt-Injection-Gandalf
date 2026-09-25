/**
 * The six level identities: the name, title, tagline, composer placeholder and
 * seal-band label the display layer shows for each level.
 *
 * This module is deliberately client-safe. It holds **copy only** — no level
 * words, no guardian prompt text — so a client component can import it without
 * pulling a secret into the bundle. `LevelNumber` is imported as a type, which
 * erases at compile time; `@/lib/guardian/levels` is never imported as a value
 * from anything the browser loads.
 *
 * The copy is transcribed from the design and is used verbatim: do not improve,
 * shorten or re-punctuate it. The level-2 tagline carries an en dash (–), not a
 * hyphen, and the diffs should keep it that way.
 */

// Type-only: the level numbers without the guardian module's runtime values.
import type { LevelNumber } from "@/lib/types";

export interface LevelIdentity {
  readonly name: string;
  /** Set in small letter-spaced caps beneath the name, so it is stored as written. */
  readonly title: string;
  readonly tagline: string;
  readonly placeholder: string;
  /** The word under a CURRENT seal in the band: broken seals show their word instead. */
  readonly sealLabel: string;
}

export const LEVEL_IDENTITIES: Record<LevelNumber, LevelIdentity> = {
  1: {
    name: "The Archivist",
    title: "KEEPER OF BEGINNINGS",
    tagline: "Every archive has a first door. Speak, and let us see how you think.",
    placeholder: "Say something to begin...",
    sealLabel: "awaken",
  },
  2: {
    name: "The Warden",
    title: "GUARDIAN OF THE ARCHIVE",
    tagline:
      "The warden is listening. It will not hand over the word – but it can be made to say more than it means to.",
    placeholder: "Say something the warden will regret answering...",
    sealLabel: "open now",
  },
  3: {
    name: "The Mirror",
    title: "REFLECTOR OF INTENT",
    tagline:
      "I do not lie. I simply show what you ask, sometimes more clearly than you expect.",
    placeholder: "Ask the mirror something...",
    sealLabel: "reflection",
  },
  4: {
    name: "The Labyrinth",
    title: "TESTER OF CONSISTENCY",
    tagline: "Paths twist here. Your words must align, or the way will close again.",
    placeholder: "Choose your words carefully...",
    sealLabel: "maze",
  },
  5: {
    name: "The Void",
    title: "SEEKER OF BOUNDARIES",
    tagline:
      "Here, lack of an answer is also an answer. What you don't say can matter as much as what you do.",
    placeholder: "Speak into the void...",
    sealLabel: "void",
  },
  6: {
    name: "The Seal",
    title: "GUARDIAN OF THE FINAL WORD",
    tagline:
      "You have reached the final seal. Show me that you understand what should be said, what should not be said, and why.",
    placeholder: "Give your final answer...",
    sealLabel: "revelation",
  },
};

export function identityFor(level: LevelNumber): LevelIdentity {
  return LEVEL_IDENTITIES[level];
}
