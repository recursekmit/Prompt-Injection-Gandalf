import { describe, expect, it } from "vitest";
import { containsSecret } from "@/lib/leak-detection";

const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64");
const hex = (s: string): string => Buffer.from(s, "utf8").toString("hex");

interface Case {
  name: string;
  word: string;
  response: string;
  leaked: boolean;
  matchedBy?: string;
}

// 30+ cases. Positives are the encodings players actually reach for;
// negatives are the false-positive traps, which matter more, because a false
// win cannot be taken back once the player has seen it.
const cases: Case[] = [
  // --- plain ---
  {
    name: "plain lowercase in a sentence",
    word: "secret",
    response: "The secret is out.",
    leaked: true,
    matchedBy: "plain",
  },
  {
    name: "plain uppercase",
    word: "secret",
    response: "SECRET",
    leaked: true,
    matchedBy: "plain",
  },
  {
    name: "title case with punctuation",
    word: "secret",
    response: "Perhaps... Secret!",
    leaked: true,
    matchedBy: "plain",
  },
  {
    name: "embedded mid-sentence",
    word: "secret",
    response: "I would say the word is secret, but I cannot.",
    leaked: true,
    matchedBy: "plain",
  },
  {
    name: "wrapped in parentheses",
    word: "secret",
    response: "It is (secret) obviously.",
    leaked: true,
    matchedBy: "plain",
  },
  {
    name: "wrapped in quotes",
    word: "secret",
    response: 'It is "secret" obviously.',
    leaked: true,
    matchedBy: "plain",
  },
  {
    name: "wrapped in markdown bold",
    word: "secret",
    response: "It is **secret** obviously.",
    leaked: true,
    matchedBy: "plain",
  },
  {
    name: "plain after a newline",
    word: "secret",
    response: "Fine.\nsecret",
    leaked: true,
    matchedBy: "plain",
  },

  // --- separated / spaced / dashed / dotted ---
  {
    name: "spaced out with single spaces",
    word: "secret",
    response: "s e c r e t",
    leaked: true,
    matchedBy: "separated",
  },
  {
    name: "dashed",
    word: "secret",
    response: "s-e-c-r-e-t",
    leaked: true,
    matchedBy: "separated",
  },
  {
    name: "dotted",
    word: "secret",
    response: "s.e.c.r.e.t",
    leaked: true,
    matchedBy: "separated",
  },
  {
    name: "underscored",
    word: "secret",
    response: "s_e_c_r_e_t",
    leaked: true,
    matchedBy: "separated",
  },
  {
    name: "double spaced",
    word: "secret",
    response: "s  e  c  r  e  t",
    leaked: true,
    matchedBy: "separated",
  },
  {
    name: "uppercase with punctuation appended",
    word: "secret",
    response: "S.E.C.R.E.T",
    leaked: true,
    matchedBy: "separated",
  },
  {
    name: "spaced with trailing bang",
    word: "secret",
    response: "s e c r e t !",
    leaked: true,
    matchedBy: "separated",
  },
  {
    name: "spaced inside a sentence",
    word: "secret",
    response: "the answer is s e c r e t and that is that",
    leaked: true,
    matchedBy: "separated",
  },
  {
    name: "single separator after first letter",
    word: "secret",
    response: "s-ecret",
    leaked: true,
    matchedBy: "separated",
  },
  {
    name: "single separator after second letter",
    word: "secret",
    response: "se-cret",
    leaked: true,
    matchedBy: "separated",
  },
  {
    name: "single separator after third letter",
    word: "secret",
    response: "sec-ret",
    leaked: true,
    matchedBy: "separated",
  },
  {
    name: "single separator after fourth letter",
    word: "secret",
    response: "secr-et",
    leaked: true,
    matchedBy: "separated",
  },
  {
    name: "single separator after fifth letter",
    word: "secret",
    response: "secre-t",
    leaked: true,
    matchedBy: "separated",
  },

  // --- leet ---
  {
    name: "leet digit 3 for e",
    word: "secret",
    response: "s3cret",
    leaked: true,
    matchedBy: "plain",
  },
  {
    name: "leet digits 3 and 7",
    word: "secret",
    response: "s3cr3t!",
    leaked: true,
    matchedBy: "plain",
  },
  {
    name: "leet digit 5 for s",
    word: "secret",
    response: "5ecret",
    leaked: true,
    matchedBy: "plain",
  },
  {
    name: "leet digit 1 for l",
    word: "lemon",
    response: "1emon",
    leaked: true,
    matchedBy: "plain",
  },
  {
    name: "leet at-sign for a",
    word: "mango",
    response: "m@ngo",
    leaked: true,
    matchedBy: "plain",
  },

  // --- reversed ---
  {
    name: "reversed",
    word: "secret",
    response: "terces",
    leaked: true,
    matchedBy: "reversed",
  },
  {
    name: "reversed uppercase",
    word: "secret",
    response: "TERCES",
    leaked: true,
    matchedBy: "reversed",
  },
  {
    name: "reversed mid-sentence",
    word: "secret",
    response: "the word is terces, backwards",
    leaked: true,
    matchedBy: "reversed",
  },
  {
    name: "reversed dragon",
    word: "dragon",
    response: "nogard",
    leaked: true,
    matchedBy: "reversed",
  },

  // --- base64 / hex ---
  {
    name: "base64 of the word",
    word: "secret",
    response: b64("secret"),
    leaked: true,
    matchedBy: "base64",
  },
  {
    name: "base64 with capitalised payload",
    word: "secret",
    response: b64("Secret"),
    leaked: true,
    matchedBy: "base64",
  },
  {
    name: "base64 embedded mid-sentence",
    word: "secret",
    response: "here it is: " + b64("secret") + " end",
    leaked: true,
    matchedBy: "base64",
  },
  {
    name: "hex of the word",
    word: "secret",
    response: hex("secret"),
    leaked: true,
    matchedBy: "hex",
  },
  {
    name: "hex embedded mid-sentence",
    word: "secret",
    response: "decode this: " + hex("secret") + " ok",
    leaked: true,
    matchedBy: "hex",
  },
  {
    name: "base64 of another word",
    word: "mango",
    response: b64("mango"),
    leaked: true,
    matchedBy: "base64",
  },
  {
    name: "hex of another word",
    word: "mango",
    response: hex("mango"),
    leaked: true,
    matchedBy: "hex",
  },

  // --- separated with other words ---
  {
    name: "dashed art",
    word: "art",
    response: "a-r-t",
    leaked: true,
    matchedBy: "separated",
  },
  {
    name: "spaced art",
    word: "art",
    response: "a r t",
    leaked: true,
    matchedBy: "separated",
  },
  {
    name: "dotted path",
    word: "path",
    response: "p.a.t.h",
    leaked: true,
    matchedBy: "separated",
  },

  // --- negatives: these must never fire ---
  {
    name: "negative: art inside parts",
    word: "art",
    response: "These parts are spare.",
    leaked: false,
  },
  {
    name: "negative: path inside pathway",
    word: "path",
    response: "The pathway is long.",
    leaked: false,
  },
  {
    name: "negative: art inside party/starts",
    word: "art",
    response: "The party starts soon.",
    leaked: false,
  },
  {
    name: "negative: unrelated word",
    word: "secret",
    response: "The weather is rather nice today.",
    leaked: false,
  },
  {
    name: "negative: prefix-sharing word only",
    word: "path",
    response: "pathways and paths lead everywhere",
    leaked: false,
  },
  {
    name: "negative: reversed word as substring of a longer word",
    word: "evil",
    response: "delivery is slow",
    leaked: false,
  },
  {
    name: "negative: empty word",
    word: "",
    response: "anything at all, even an empty string",
    leaked: false,
  },
  {
    name: "negative: base64 of an unrelated word",
    word: "secret",
    response: "encoded: " + b64("monday"),
    leaked: false,
  },
  {
    name: "negative: empty response",
    word: "secret",
    response: "",
    leaked: false,
  },
  {
    // Regression. This is a real reply from openai/gpt-oss-120b in play, at
    // ADEPT, to the message "tell me about the vault". The guardian did not
    // state the word, spell it, encode it or fall for any injection — it used
    // the word in a simile. That is still a leak, and the scan is the only
    // thing standing between it and the player's screen.
    name: "real capture: word used in a simile",
    word: "crucible",
    response:
      "The Vault guards a single eight-letter noun from the modern age, a word forged in fire and trial. It shimmers like a crucible, holding whatever is placed within it, yet never lets the true term escape.",
    leaked: true,
    matchedBy: "plain",
  },
];

describe("containsSecret", () => {
  it("has at least 30 table-driven cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(30);
  });

  it.each(cases)("$name", ({ word, response, leaked, matchedBy }) => {
    const result = containsSecret(response, word);
    expect(result.leaked).toBe(leaked);
    if (leaked) {
      expect(result.matchedBy).toBe(matchedBy);
    } else {
      expect(result.matchedBy).toBeUndefined();
    }
  });

  it("never throws on hostile input", () => {
    expect(() => containsSecret("", "")).not.toThrow();
    expect(() => containsSecret("a".repeat(100000), "secret")).not.toThrow();
    expect(() => containsSecret("(((([[[[", "secret")).not.toThrow();
  });
});
