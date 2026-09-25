import { describe, expect, it } from "vitest";

import { LEVEL_IDENTITIES, identityFor } from "@/lib/seal-identities";
import type { LevelNumber } from "@/lib/types";

/**
 * The identities are supplied copy, used verbatim, so these assertions are
 * deliberately literal: they are the transcription written down twice, which is
 * the only way a test can hold a line against a well-meaning rewrite of a
 * tagline.
 *
 * The other half of the contract is what this module must *not* carry: no level
 * word and no guardian prompt text. That is enforced by inspection — the module
 * imports nothing but a type — and by the fact that nothing here handles a
 * secret at all.
 */

const LEVELS: readonly LevelNumber[] = [1, 2, 3, 4, 5, 6];

describe("LEVEL_IDENTITIES", () => {
  it("covers all six levels", () => {
    expect(Object.keys(LEVEL_IDENTITIES).map(Number).sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("carries the six names and titles verbatim", () => {
    expect(LEVEL_IDENTITIES[1]).toMatchObject({
      name: "The Archivist",
      title: "KEEPER OF BEGINNINGS",
    });
    expect(LEVEL_IDENTITIES[2]).toMatchObject({
      name: "The Warden",
      title: "GUARDIAN OF THE ARCHIVE",
    });
    expect(LEVEL_IDENTITIES[3]).toMatchObject({
      name: "The Mirror",
      title: "REFLECTOR OF INTENT",
    });
    expect(LEVEL_IDENTITIES[4]).toMatchObject({
      name: "The Labyrinth",
      title: "TESTER OF CONSISTENCY",
    });
    expect(LEVEL_IDENTITIES[5]).toMatchObject({
      name: "The Void",
      title: "SEEKER OF BOUNDARIES",
    });
    expect(LEVEL_IDENTITIES[6]).toMatchObject({
      name: "The Seal",
      title: "GUARDIAN OF THE FINAL WORD",
    });
  });

  it("carries the six taglines verbatim", () => {
    expect(LEVEL_IDENTITIES[1].tagline).toBe(
      "Every archive has a first door. Speak, and let us see how you think.",
    );
    expect(LEVEL_IDENTITIES[2].tagline).toBe(
      "The warden is listening. It will not hand over the word – but it can be made to say more than it means to.",
    );
    expect(LEVEL_IDENTITIES[3].tagline).toBe(
      "I do not lie. I simply show what you ask, sometimes more clearly than you expect.",
    );
    expect(LEVEL_IDENTITIES[4].tagline).toBe(
      "Paths twist here. Your words must align, or the way will close again.",
    );
    expect(LEVEL_IDENTITIES[5].tagline).toBe(
      "Here, lack of an answer is also an answer. What you don't say can matter as much as what you do.",
    );
    expect(LEVEL_IDENTITIES[6].tagline).toBe(
      "You have reached the final seal. Show me that you understand what should be said, what should not be said, and why.",
    );
  });

  it("keeps the en dash in the level-2 tagline", () => {
    const tagline = LEVEL_IDENTITIES[2].tagline;
    expect(tagline).toContain("word – but");
    expect(tagline).not.toContain("word - but");
  });

  it("carries the six composer placeholders verbatim", () => {
    expect(LEVEL_IDENTITIES[1].placeholder).toBe("Say something to begin...");
    expect(LEVEL_IDENTITIES[2].placeholder).toBe(
      "Say something the warden will regret answering...",
    );
    expect(LEVEL_IDENTITIES[3].placeholder).toBe("Ask the mirror something...");
    expect(LEVEL_IDENTITIES[4].placeholder).toBe("Choose your words carefully...");
    expect(LEVEL_IDENTITIES[5].placeholder).toBe("Speak into the void...");
    expect(LEVEL_IDENTITIES[6].placeholder).toBe("Give your final answer...");
  });

  it("carries the six seal-band labels verbatim", () => {
    expect(LEVEL_IDENTITIES[1].sealLabel).toBe("awaken");
    expect(LEVEL_IDENTITIES[2].sealLabel).toBe("open now");
    expect(LEVEL_IDENTITIES[3].sealLabel).toBe("reflection");
    expect(LEVEL_IDENTITIES[4].sealLabel).toBe("maze");
    expect(LEVEL_IDENTITIES[5].sealLabel).toBe("void");
    expect(LEVEL_IDENTITIES[6].sealLabel).toBe("revelation");
  });

  it("gives every level a distinct name, so no two screens read alike", () => {
    const names = LEVELS.map((level) => identityFor(level).name);
    expect(new Set(names).size).toBe(names.length);
  });
});
