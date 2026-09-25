import { describe, expect, it } from "vitest";
import { BCRYPT_COST, hashPassword, verifyPassword } from "./password";

const TEST_COST = 4;

describe("hashPassword", () => {
  it("round-trips: the hashed password verifies", async () => {
    const hash = await hashPassword("correct horse battery staple", TEST_COST);
    await expect(
      verifyPassword("correct horse battery staple", hash),
    ).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple", TEST_COST);
    await expect(verifyPassword("Correct horse battery staple", hash)).resolves.toBe(
      false,
    );
    await expect(verifyPassword("", hash)).resolves.toBe(false);
  });

  it("produces a different hash each time because the salt is random", async () => {
    const first = await hashPassword("same input", TEST_COST);
    const second = await hashPassword("same input", TEST_COST);
    expect(first).not.toBe(second);
    await expect(verifyPassword("same input", first)).resolves.toBe(true);
    await expect(verifyPassword("same input", second)).resolves.toBe(true);
  });

  it("honours an injected cost, visible in the hash prefix", async () => {
    const hash = await hashPassword("same input", TEST_COST);
    expect(hash.startsWith("$2b$04$")).toBe(true);
  });

  it("exported default cost is production-grade", () => {
    expect(BCRYPT_COST).toBe(12);
  });

  it("never hashes the plaintext into the output", async () => {
    const hash = await hashPassword("plaintextpassword", TEST_COST);
    expect(hash).not.toContain("plaintextpassword");
  });
});

describe("verifyPassword", () => {
  it("resolves false for a malformed hash instead of throwing", async () => {
    await expect(verifyPassword("anything", "not-a-hash")).resolves.toBe(false);
    await expect(verifyPassword("anything", "")).resolves.toBe(false);
    await expect(verifyPassword("anything", "$2b$04$short")).resolves.toBe(false);
  });
});
