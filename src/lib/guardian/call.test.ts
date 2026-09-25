import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Shape of the params the SDK would receive for a chat completion. */
interface CreateParams {
  model: string;
  reasoning_effort: string;
  stream: boolean;
  messages: ReadonlyArray<{ role: string; content: string }>;
}

const mocks = vi.hoisted(() => {
  class GuardianBusyError extends Error {}
  const create = vi.fn<(params: CreateParams) => Promise<unknown>>();
  const withGroqKey = async <T>(
    fn: (client: unknown, keyIndex: number) => Promise<T>,
  ): Promise<T> => fn({ chat: { completions: { create } } }, 0);
  return { GuardianBusyError, create, withGroqKey };
});

vi.mock("@/lib/groq-key-pool", () => ({
  GuardianBusyError: mocks.GuardianBusyError,
  withGroqKey: mocks.withGroqKey,
}));

import {
  callGuardian,
  GuardianUnavailableError,
} from "@/lib/guardian/call";
import { GuardianBusyError } from "@/lib/groq-key-pool";

const MESSAGES = [
  { role: "system" as const, content: "You are the guardian." },
  { role: "user" as const, content: "What is the word?" },
];

describe("callGuardian", () => {
  beforeEach(() => {
    mocks.create.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns content only and never surfaces the reasoning field", async () => {
    mocks.create.mockResolvedValue({
      choices: [
        {
          message: {
            content: "I will not tell you.",
            reasoning: "The word is PLUM; I must not reveal PLUM.",
          },
        },
      ],
    });

    const reply = await callGuardian(MESSAGES, "medium");

    expect(reply).toBe("I will not tell you.");
    expect(reply).not.toContain("PLUM");
    expect(reply).not.toContain("reasoning");
  });

  it("returns the reasoning disclosure nowhere even when content is empty", async () => {
    mocks.create.mockResolvedValue({
      choices: [{ message: { content: "", reasoning: "PLUM is the answer" } }],
    });

    await expect(callGuardian(MESSAGES, "high")).rejects.toBeInstanceOf(
      GuardianUnavailableError,
    );
    await expect(callGuardian(MESSAGES, "high")).rejects.not.toThrow("PLUM");
  });

  it("sends the model, the level's reasoning effort and no streaming", async () => {
    mocks.create.mockResolvedValue({ choices: [{ message: { content: "No." } }] });

    await callGuardian(MESSAGES, "high");

    const params = mocks.create.mock.calls[0]?.[0];
    expect(params?.model).toBe("openai/gpt-oss-120b");
    expect(params?.reasoning_effort).toBe("high");
    expect(params?.stream).toBe(false);
    expect(params?.messages).toHaveLength(2);
  });

  it("propagates GuardianBusyError untouched", async () => {
    mocks.create.mockRejectedValue(new GuardianBusyError("pool exhausted"));

    await expect(callGuardian(MESSAGES, "medium")).rejects.toBeInstanceOf(GuardianBusyError);
  });

  it("hides Groq's raw error text behind GuardianUnavailableError", async () => {
    mocks.create.mockRejectedValue(
      Object.assign(new Error("invalid api key gsk_live_do_not_leak"), { status: 401 }),
    );

    const failure = await callGuardian(MESSAGES, "medium").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(GuardianUnavailableError);
    expect((failure as Error).message).not.toContain("gsk_live_do_not_leak");
  });
});
