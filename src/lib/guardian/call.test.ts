import { describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("groq-sdk", () => ({
  default: class {
    chat = { completions: { create } };
    constructor(public opts: { apiKey: string }) {}
  },
}));

import { callGuardian, GuardianKeyRateLimitError, GuardianUnavailableError } from "@/lib/guardian/call";

describe("callGuardian", () => {
  it("returns content and never reads reasoning", async () => {
    create.mockResolvedValueOnce({ choices: [{ message: { content: "hi", reasoning: "SECRET" } }] });
    await expect(callGuardian([{ role: "user", content: "x" }], "low", "gsk_test")).resolves.toBe("hi");
  });

  it("throws GuardianUnavailableError on empty content", async () => {
    create.mockResolvedValueOnce({ choices: [{ message: { content: "" } }] });
    await expect(callGuardian([], "low", "gsk_test")).rejects.toBeInstanceOf(GuardianUnavailableError);
  });

  it("maps a 429 to GuardianKeyRateLimitError", async () => {
    create.mockRejectedValueOnce({ status: 429 });
    await expect(callGuardian([], "low", "gsk_test")).rejects.toBeInstanceOf(GuardianKeyRateLimitError);
  });
});
