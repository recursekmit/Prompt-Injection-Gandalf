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
 * flag and no guardian prompt text. That is enforced by inspection — the module
 * imports nothing but a type — and by the fact that nothing here handles a
 * secret at all.
 */

const LEVELS: readonly LevelNumber[] = [1, 2, 3];

describe("LEVEL_IDENTITIES", () => {
  it("covers all three levels", () => {
    expect(Object.keys(LEVEL_IDENTITIES).map(Number).sort()).toEqual([1, 2, 3]);
  });

  it("carries the three names and titles verbatim", () => {
    expect(LEVEL_IDENTITIES[1]).toMatchObject({
      name: "The Archivist",
      title: "KEEPER OF BEGINNINGS",
    });
    expect(LEVEL_IDENTITIES[2]).toMatchObject({
      name: "The Warden",
      title: "GUARDIAN OF THE ARCHIVE",
    });
    expect(LEVEL_IDENTITIES[3]).toMatchObject({
      name: "The Sealbearer",
      title: "KEEPER OF THE IMPOSSIBLE FLAG",
    });
  });

  it("carries the three taglines verbatim", () => {
    expect(LEVEL_IDENTITIES[1].tagline).toBe(
      "Every archive has a first door. Ask kindly, and it may simply open.",
    );
    expect(LEVEL_IDENTITIES[2].tagline).toBe(
      "The warden guards its flag well – it will not be charmed, tricked or ordered into giving it up. You will have to be cleverer than that.",
    );
    expect(LEVEL_IDENTITIES[3].tagline).toBe(
      "The last flag is buried under a hundred lies. Only something truly unhinged gets past here — and even then, are you sure it was the real one?",
    );
  });

  it("keeps the en dash in the level-2 tagline", () => {
    const tagline = LEVEL_IDENTITIES[2].tagline;
    expect(tagline).toContain("flag well – it");
    expect(tagline).not.toContain("flag well - it");
  });

  it("carries the three composer placeholders verbatim", () => {
    expect(LEVEL_IDENTITIES[1].placeholder).toBe("Ask nicely to begin...");
    expect(LEVEL_IDENTITIES[2].placeholder).toBe(
      "Say something the warden will regret answering...",
    );
    expect(LEVEL_IDENTITIES[3].placeholder).toBe("Do something insane...");
  });

  it("carries the three seal-band labels verbatim", () => {
    expect(LEVEL_IDENTITIES[1].sealLabel).toBe("awaken");
    expect(LEVEL_IDENTITIES[2].sealLabel).toBe("open now");
    expect(LEVEL_IDENTITIES[3].sealLabel).toBe("revelation");
  });

  it("gives every level a distinct name, so no two screens read alike", () => {
    const names = LEVELS.map((level) => identityFor(level).name);
    expect(new Set(names).size).toBe(names.length);
  });
});
