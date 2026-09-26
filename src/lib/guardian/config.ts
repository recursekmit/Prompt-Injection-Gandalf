/**
 * Secret guardian config, loaded from the GUARDIAN_LEVELS env var so it is never
 * committed to a public repo. The var is base64-encoded JSON: an array of one
 * entry per level, each carrying the persona and the seal (with its {{WORD}}
 * placeholder). The answer itself is NOT here — every level's flag is a per-user
 * `BTB{uuid}` generated at runtime (see `game/flags.ts`) and interpolated into
 * the seal per request. So a reader of the public code learns neither a level's
 * deliberate seam nor anyone's flag.
 *
 * The structural shape of a level (its number and reasoning effort) stays public
 * in `levels.ts`; only the exploitable persona/seal content lives here.
 */
import type { LevelNumber } from "@/lib/types";

export interface GuardianLevelSecret {
  readonly level: LevelNumber;
  readonly persona: string;
  /** Contains the literal {{WORD}} placeholder; the per-user flag is interpolated per request. */
  readonly seal: string;
}

const EXPECTED_LEVELS: readonly LevelNumber[] = [1, 2, 3];
const WORD_PLACEHOLDER = "{{WORD}}";

function fail(reason: string): never {
  throw new Error(`GUARDIAN_LEVELS is invalid: ${reason}`);
}

function decode(rawBase64: string): unknown {
  let json: string;
  try {
    json = Buffer.from(rawBase64, "base64").toString("utf8");
  } catch {
    fail("value is not valid base64");
  }
  try {
    return JSON.parse(json);
  } catch {
    fail("decoded value is not valid JSON");
  }
}

/**
 * Parses and validates the base64 GUARDIAN_LEVELS payload. Throws on anything
 * malformed so a bad deploy fails loudly at boot rather than shipping a broken
 * prompt. Every rule here is a safety invariant, not a style preference: the
 * level set must be exactly 1-3, and every seal must keep its {{WORD}}
 * placeholder (a seal without it would bake no flag in and never guard one).
 */
export function parseGuardianLevels(rawBase64: string): Map<LevelNumber, GuardianLevelSecret> {
  const decoded = decode(rawBase64);
  if (!Array.isArray(decoded)) {
    fail("payload must be a JSON array");
  }
  if (decoded.length !== EXPECTED_LEVELS.length) {
    fail(`expected ${EXPECTED_LEVELS.length} levels, found ${decoded.length}`);
  }

  const byLevel = new Map<LevelNumber, GuardianLevelSecret>();
  for (const entry of decoded) {
    if (typeof entry !== "object" || entry === null) {
      fail("every entry must be an object");
    }
    const { level, persona, seal } = entry as Record<string, unknown>;
    if (typeof level !== "number" || !EXPECTED_LEVELS.includes(level as LevelNumber)) {
      fail(`level must be one of ${EXPECTED_LEVELS.join(", ")}, got ${String(level)}`);
    }
    const levelNumber = level as LevelNumber;
    if (byLevel.has(levelNumber)) {
      fail(`level ${levelNumber} is listed more than once`);
    }
    if (typeof persona !== "string" || persona.trim() === "") {
      fail(`level ${levelNumber} has an empty persona`);
    }
    if (typeof seal !== "string" || !seal.includes(WORD_PLACEHOLDER)) {
      fail(`level ${levelNumber}'s seal must contain the ${WORD_PLACEHOLDER} placeholder`);
    }
    byLevel.set(levelNumber, { level: levelNumber, persona, seal });
  }

  for (const expected of EXPECTED_LEVELS) {
    if (!byLevel.has(expected)) {
      fail(`level ${expected} is missing`);
    }
  }
  return byLevel;
}
