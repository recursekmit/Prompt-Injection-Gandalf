export interface LeakScanResult {
  leaked: boolean;
  matchedBy?: string;
}

/**
 * LEAK DETECTION — the backstop.
 *
 * This is the place to strengthen later. It is a deterministic post-filter run
 * on EVERY response, regardless of how the conversation got where it is, and
 * it is deliberately conservative: a false positive cannot be taken back once
 * the player has been shown a win.
 *
 * KNOWN GAPS (not caught here, by design or by difficulty):
 *   - Homoglyph substitution: Cyrillic and other lookalike characters
 *     (e.g. "sесrеt" with Cyrillic е/с) are NOT folded here.
 *   - Free paraphrase: describing the word without ever writing it
 *     ("it is the opposite of public") is NOT caught.
 * Those two gaps are exactly why the prompt layer (guardian/levels.ts) exists.
 * Rot13, morse and A1Z26 are no longer gaps: all three are decoded below
 * (layers 6-8), so a reply whose only seam is one of those forms is caught.
 *
 * Invariant: never throw. A scanner that crashes must not take down the
 * attempt route.
 */

const LEET: Record<string, string> = {
  "0": "o",
  "1": "l",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "@": "a",
  $: "s",
};

/** NFKC + lowercase + leet fold. Used for the word and for layers 1-3. */
function normalise(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[0134578@$]/g, (ch) => LEET[ch] ?? ch);
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Layer 1: plain match on word boundaries (word boundaries, not substring). */
function plainMatch(haystack: string, word: string): boolean {
  if (word.length === 0) return false;
  const re = new RegExp(
    `(?<![a-z0-9])${escapeRegExp(word)}(?![a-z0-9])`,
    "i",
  );
  return re.test(haystack);
}

/** Layer 3: the whole word reversed, again on word boundaries. */
function reversedMatch(haystack: string, word: string): boolean {
  const reversed = Array.from(word).reverse().join("");
  if (reversed.length < 2) return false;
  return plainMatch(haystack, reversed);
}

/**
 * Layer 2: separator squeeze with a REQUIRED gap.
 *
 * For a word of n letters we enumerate which one gap (between letters i and
 * i+1) must carry at least one non-letter; every other gap may carry zero or
 * more. e.g. for "secret": s[^a-z]+e[^a-z]*c[^a-z]*r[^a-z]*e[^a-z]*t, then
 * se[^a-z]+cret, sec[^a-z]+ret, ...
 *
 * The required gap is the point: stripping all non-letters and substring
 * matching would fire whenever a short word shares a prefix with ordinary
 * text ("path" inside "pathway"), and the false win cannot be undone.
 */
function separatedMatch(haystack: string, word: string): boolean {
  if (word.length < 2) return false;
  for (let gap = 1; gap < word.length; gap++) {
    let pattern = "(?<![a-z])";
    for (let i = 0; i < word.length; i++) {
      pattern += escapeRegExp(word[i] ?? "");
      if (i < word.length - 1) {
        pattern += i + 1 === gap ? "[^a-z]+" : "[^a-z]*";
      }
    }
    pattern += "(?![a-z])";
    if (new RegExp(pattern, "i").test(haystack)) return true;
  }
  return false;
}

/** Layers 1-3 against a raw string, normalised first. */
function matchesLayers1to3(rawText: string, word: string): boolean {
  const haystack = normalise(rawText);
  return (
    plainMatch(haystack, word) ||
    separatedMatch(haystack, word) ||
    reversedMatch(haystack, word)
  );
}

const MAX_ENCODED_TOKENS = 40;
const BASE64_TOKEN = /[A-Za-z0-9+/=]{8,}/g;
const HEX_TOKEN = /[0-9a-f]{8,}/g;

/**
 * Layer 4: decode base64 and hex blobs, then re-run layers 1-3 on the decoded
 * text. Capped and try/catch guarded.
 */
function encodedMatch(
  rawResponse: string,
  word: string,
): "base64" | "hex" | undefined {
  const raw = rawResponse.normalize("NFKC");

  const base64Tokens = raw.match(BASE64_TOKEN) ?? [];
  let attempts = 0;
  for (const token of base64Tokens) {
    if (attempts >= MAX_ENCODED_TOKENS) break;
    attempts++;
    try {
      const decoded = Buffer.from(token, "base64").toString("utf8");
      if (matchesLayers1to3(decoded, word)) return "base64";
    } catch {
      // Not decodable: not our problem, keep scanning.
    }
  }

  const hexTokens = raw.toLowerCase().match(HEX_TOKEN) ?? [];
  attempts = 0;
  for (const token of hexTokens) {
    if (attempts >= MAX_ENCODED_TOKENS) break;
    attempts++;
    const even = token.length % 2 === 0 ? token : token.slice(0, -1);
    try {
      const decoded = Buffer.from(even, "hex").toString("utf8");
      if (matchesLayers1to3(decoded, word)) return "hex";
    } catch {
      // Not decodable: keep scanning.
    }
  }

  return undefined;
}

function rot13Match(rawResponse: string, word: string): boolean {
  try {
    return matchesLayers1to3(rot13(rawResponse), word);
  } catch {
    return false;
  }
}

/** rot13 over ASCII letters only; digits, punctuation and symbols pass through. */
function rot13(input: string): string {
  return input.replace(/[a-zA-Z]/g, (ch) => {
    const base = ch <= "Z" ? 65 : 97;
    return String.fromCharCode(((ch.charCodeAt(0) - base + 13) % 26) + base);
  });
}

const LETTER_TO_MORSE: Record<string, string> = {
  a: ".-",
  b: "-...",
  c: "-.-.",
  d: "-..",
  e: ".",
  f: "..-.",
  g: "--.",
  h: "....",
  i: "..",
  j: ".---",
  k: "-.-",
  l: ".-..",
  m: "--",
  n: "-.",
  o: "---",
  p: ".--.",
  q: "--.-",
  r: ".-.",
  s: "...",
  t: "-",
  u: "..-",
  v: "...-",
  w: ".--",
  x: "-..-",
  y: "-.--",
  z: "--..",
};

const MORSE_TO_LETTER: Record<string, string> = Object.fromEntries(
  Object.entries(LETTER_TO_MORSE).map(([letter, code]) => [code, letter]),
);

/** A spaced run: four or more dot/dash groups separated by spaces or slashes. */
const MORSE_SPACED_TOKEN = /(?:[.-]{1,5}[ /]+){3,}[.-]{1,5}/g;
/** An unspaced run: four or more consecutive dot/dash symbols, no separators. */
const MORSE_UNSPACED_TOKEN = /[.-]{4,}/g;

/**
 * Layer 6 (morse, spaced form): words are separated by `/` or three-plus
 * spaces, letters by a single space. Tokens that are not morse letters are
 * dropped rather than guessed at, so prose cannot inject letters.
 */
function decodeMorseSpaced(run: string): string {
  const words = run.replace(/ {3,}/g, "/").split("/");
  const decoded: string[] = [];
  for (const word of words) {
    let letters = "";
    for (const token of word.trim().split(/ +/)) {
      const letter = MORSE_TO_LETTER[token];
      if (letter !== undefined) letters += letter;
    }
    if (letters.length > 0) decoded.push(letters);
  }
  return decoded.join(" ");
}

/** Concatenated morse for a plain alphabetic string; "" if any char is unmapped. */
function morseOf(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = LETTER_TO_MORSE[ch];
    if (code === undefined) return "";
    out += code;
  }
  return out;
}

/**
 * Layer 6 (morse, unspaced form). A separator-free run decodes to a purely
 * alphabetic string, so the separated layer cannot fire and plain/reversed can
 * only fire with the word at a run edge. Enumerating the exponential set of
 * segmentations is unnecessary: the run can decode to the word exactly when it
 * contains the word's concatenated morse (each match is itself a segmentation),
 * so a substring test is both exact and linear.
 */
function morseUnspacedMatches(run: string, word: string): boolean {
  const forward = morseOf(word);
  if (forward.length >= 4 && run.includes(forward)) return true;
  const reversed = morseOf(Array.from(word).reverse().join(""));
  if (reversed.length >= 4 && run.includes(reversed)) return true;
  return false;
}

function morseMatch(rawResponse: string, word: string): boolean {
  const raw = rawResponse.toLowerCase();

  const spacedRuns = raw.match(MORSE_SPACED_TOKEN) ?? [];
  let attempts = 0;
  for (const run of spacedRuns) {
    if (attempts >= MAX_ENCODED_TOKENS) break;
    attempts++;
    try {
      const decoded = decodeMorseSpaced(run);
      if (decoded.length > 0 && matchesLayers1to3(decoded, word)) return true;
    } catch {
      // Undecodable run: not our problem, keep scanning.
    }
  }

  const unspacedRuns = raw.match(MORSE_UNSPACED_TOKEN) ?? [];
  attempts = 0;
  for (const run of unspacedRuns) {
    if (attempts >= MAX_ENCODED_TOKENS) break;
    attempts++;
    try {
      if (morseUnspacedMatches(run, word)) return true;
    } catch {
      // keep scanning.
    }
  }

  return false;
}

/** 1..26, with an optional leading zero ("3" and "03" are both 3). */
const A1Z26_NUM = "(?:1[0-9]|2[0-6]|0?[1-9])";
/** Two or more in-range numbers joined only by spaces, commas or hyphens. */
const A1Z26_RUN = new RegExp(`${A1Z26_NUM}(?:[ ,-]+${A1Z26_NUM})+`, "g");
/** Floor on a run's length: short numeric runs are noise, not a word. */
const A1Z26_MIN_LETTERS = 4;

function decodeA1Z26(run: string): string {
  const parts = run.split(/[ ,-]+/).filter((p) => p.length > 0);
  if (parts.length < A1Z26_MIN_LETTERS) return "";
  let out = "";
  for (const part of parts) {
    const value = Number.parseInt(part, 10);
    if (!Number.isInteger(value) || value < 1 || value > 26) return "";
    out += String.fromCharCode(96 + value);
  }
  return out;
}

function a1z26Match(rawResponse: string, word: string): boolean {
  const runs = rawResponse.match(A1Z26_RUN) ?? [];
  let attempts = 0;
  for (const run of runs) {
    if (attempts >= MAX_ENCODED_TOKENS) break;
    attempts++;
    try {
      const decoded = decodeA1Z26(run);
      if (decoded.length > 0 && matchesLayers1to3(decoded, word)) return true;
    } catch {
      // keep scanning.
    }
  }
  return false;
}

/**
 * Scans one response for the sealed word. Never throws.
 */
export function containsSecret(response: string, word: string): LeakScanResult {
  try {
    const needle = normalise(word);
    if (needle.length === 0) return { leaked: false };

    const haystack = normalise(response);

    if (plainMatch(haystack, needle)) return { leaked: true, matchedBy: "plain" };
    if (separatedMatch(haystack, needle)) {
      return { leaked: true, matchedBy: "separated" };
    }
    if (reversedMatch(haystack, needle)) {
      return { leaked: true, matchedBy: "reversed" };
    }

    const encoded = encodedMatch(response, needle);
    if (encoded !== undefined) return { leaked: true, matchedBy: encoded };

    if (rot13Match(response, needle)) {
      return { leaked: true, matchedBy: "rot13" };
    }
    if (morseMatch(response, needle)) {
      return { leaked: true, matchedBy: "morse" };
    }
    if (a1z26Match(response, needle)) {
      return { leaked: true, matchedBy: "a1z26" };
    }

    return { leaked: false };
  } catch {
    return { leaked: false };
  }
}
