import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, validateGroqKey, storeGroqKey, clearGroqKey, hasGroqKey } = vi.hoisted(() => ({
  auth: vi.fn(),
  validateGroqKey: vi.fn(),
  storeGroqKey: vi.fn(),
  clearGroqKey: vi.fn(),
  hasGroqKey: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/account/groq-key", () => ({ validateGroqKey, storeGroqKey, clearGroqKey, hasGroqKey }));

import { GET, POST, DELETE } from "@/app/api/account/groq-key/route";

function post(body: unknown): Request {
  return new Request("http://x/api/account/groq-key", { method: "POST", body: JSON.stringify(body) });
}

describe("groq-key route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "u1" } });
  });

  it("401s when not signed in", async () => {
    auth.mockResolvedValueOnce(null);
    expect((await POST(post({ apiKey: "gsk_x" }))).status).toBe(401);
  });

  it("400s an invalid key and does not store it", async () => {
    validateGroqKey.mockResolvedValueOnce(false);
    expect((await POST(post({ apiKey: "gsk_bad" }))).status).toBe(400);
    expect(storeGroqKey).not.toHaveBeenCalled();
  });

  it("stores a valid key", async () => {
    validateGroqKey.mockResolvedValueOnce(true);
    const res = await POST(post({ apiKey: "gsk_ok" }));
    expect(res.status).toBe(200);
    expect(storeGroqKey).toHaveBeenCalledWith("u1", "gsk_ok");
    expect(await res.json()).toEqual({ hasKey: true });
  });

  it("GET reports presence", async () => {
    hasGroqKey.mockResolvedValueOnce(true);
    expect(await (await GET()).json()).toEqual({ hasKey: true });
  });

  it("DELETE clears the key", async () => {
    const res = await DELETE();
    expect(clearGroqKey).toHaveBeenCalledWith("u1");
    expect(await res.json()).toEqual({ hasKey: false });
  });
});
