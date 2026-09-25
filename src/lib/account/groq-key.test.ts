import { beforeEach, describe, expect, it, vi } from "vitest";

const { list, findUnique, update } = vi.hoisted(() => ({
  list: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
}));
vi.mock("groq-sdk", () => ({
  default: class {
    models = { list };
    constructor(public opts: { apiKey: string }) {}
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique, update } } }));
vi.mock("@/lib/env", () => ({ env: { keyEncryptionKey: Buffer.alloc(32, 9).toString("base64") } }));

import { validateGroqKey, storeGroqKey, getGroqKey, hasGroqKey, clearGroqKey } from "@/lib/account/groq-key";
import { encryptSecret } from "@/lib/crypto/secret-box";

const KEY = Buffer.alloc(32, 9).toString("base64");

describe("groq-key service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("validateGroqKey is true when Groq accepts the key", async () => {
    list.mockResolvedValueOnce({ data: [] });
    await expect(validateGroqKey("gsk_ok")).resolves.toBe(true);
  });

  it("validateGroqKey is false when Groq rejects the key", async () => {
    list.mockRejectedValueOnce({ status: 401 });
    await expect(validateGroqKey("gsk_bad")).resolves.toBe(false);
  });

  it("storeGroqKey writes an encrypted value, not the plaintext", async () => {
    await storeGroqKey("u1", "gsk_plain");
    const written = update.mock.calls[0][0].data.groqKeyEnc as string;
    expect(written).not.toContain("gsk_plain");
    expect(written.split(":")).toHaveLength(3);
  });

  it("getGroqKey decrypts a stored value", async () => {
    findUnique.mockResolvedValueOnce({ groqKeyEnc: encryptSecret("gsk_plain", KEY) });
    await expect(getGroqKey("u1")).resolves.toBe("gsk_plain");
  });

  it("getGroqKey returns null when none stored", async () => {
    findUnique.mockResolvedValueOnce({ groqKeyEnc: null });
    await expect(getGroqKey("u1")).resolves.toBeNull();
  });

  it("hasGroqKey reflects presence", async () => {
    findUnique.mockResolvedValueOnce({ groqKeyEnc: encryptSecret("x", KEY) });
    await expect(hasGroqKey("u1")).resolves.toBe(true);
  });

  it("clearGroqKey nulls the column", async () => {
    await clearGroqKey("u1");
    expect(update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { groqKeyEnc: null } });
  });
});
