import { describe, expect, it } from "vitest";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secret-box";

// A valid 32-byte key, base64.
const KEY = Buffer.alloc(32, 7).toString("base64");

describe("secret-box", () => {
  it("round-trips a value", () => {
    const box = encryptSecret("gsk_secret_value", KEY);
    expect(box).not.toContain("gsk_secret_value");
    expect(decryptSecret(box, KEY)).toBe("gsk_secret_value");
  });

  it("produces a fresh iv each call", () => {
    expect(encryptSecret("x", KEY)).not.toBe(encryptSecret("x", KEY));
  });

  it("rejects a tampered ciphertext", () => {
    const [iv, tag, data] = encryptSecret("x", KEY).split(":");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 0xff;
    const bad = [iv, tag, flipped.toString("base64")].join(":");
    expect(() => decryptSecret(bad, KEY)).toThrow();
  });

  it("rejects a wrong-length key", () => {
    expect(() => encryptSecret("x", Buffer.alloc(16).toString("base64"))).toThrow(
      "KEY_ENCRYPTION_KEY must decode to 32 bytes",
    );
  });

  it("rejects a malformed payload", () => {
    expect(() => decryptSecret("nope", KEY)).toThrow();
  });
});
