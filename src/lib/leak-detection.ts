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
 * Those gaps are exactly why the prompt layer (guardian/prompt.ts) exists.
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

    return { leaked: false };
  } catch {
    return { leaked: false };
  }
}
