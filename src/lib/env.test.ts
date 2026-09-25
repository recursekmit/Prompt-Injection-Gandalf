import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `env.ts` validates eagerly at import time, so importing it requires the
 * required variables to be present. A real environment always wins; the
 * fallbacks only exist so the suite can run before Task 3 creates `.env`.
 */
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.AUTH_SECRET ??= "test-secret";
process.env.GROQ_API_KEYS ??= "key-one,key-two";

const { optionalInt, parseList } = await import("./env");

describe("parseList", () => {
  it("splits on commas and trims each entry", () => {
    expect(parseList("a, b ,c")).toEqual(["a", "b", "c"]);
  });

  it("drops empty entries", () => {
    expect(parseList("a,,b,")).toEqual(["a", "b"]);
  });

  it("returns an empty array for an empty or whitespace string", () => {
    expect(parseList("")).toEqual([]);
    expect(parseList("   ")).toEqual([]);
  });

  it("does not hardcode a key count", () => {
    const four = parseList("k1,k2,k3,k4");
    const fifteen = parseList(Array.from({ length: 15 }, (_, i) => `k${i}`).join(","));
    expect(four).toHaveLength(4);
    expect(fifteen).toHaveLength(15);
  });

  it("preserves a single key", () => {
    expect(parseList("only-one")).toEqual(["only-one"]);
  });
});

describe("optionalInt", () => {
  const NAME = "PROMPTGUARD_TEST_INT";

  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env[NAME];
  });

  it("returns the fallback when unset", () => {
    delete process.env[NAME];
    expect(optionalInt(NAME, 42)).toBe(42);
  });

  it("returns the fallback when blank", () => {
    process.env[NAME] = "   ";
    expect(optionalInt(NAME, 42)).toBe(42);
  });

  it("parses a valid value", () => {
    process.env[NAME] = "1000";
    expect(optionalInt(NAME, 42)).toBe(1000);
  });

  it("throws on a non-numeric value, naming the variable", () => {
    process.env[NAME] = "many";
    expect(() => optionalInt(NAME, 42)).toThrowError(/PROMPTGUARD_TEST_INT/);
  });

  it("throws on zero or a negative value", () => {
    process.env[NAME] = "0";
    expect(() => optionalInt(NAME, 42)).toThrowError(/positive integer/);
    process.env[NAME] = "-3";
    expect(() => optionalInt(NAME, 42)).toThrowError(/positive integer/);
  });
});

describe("env", () => {
  it("fails loudly at import time when a required variable is missing", async () => {
    const original = process.env.GROQ_API_KEYS;
    delete process.env.GROQ_API_KEYS;
    vi.resetModules();
    try {
      await expect(import("./env")).rejects.toThrowError(/GROQ_API_KEYS/);
    } finally {
      process.env.GROQ_API_KEYS = original;
      vi.resetModules();
    }
  });
});
