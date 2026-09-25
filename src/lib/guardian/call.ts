import { GuardianBusyError, withGroqKey } from "@/lib/groq-key-pool";
import type { Tier } from "@/lib/types";

/** The only model the guardian runs on. */
const GUARDIAN_MODEL = "openai/gpt-oss-120b";

/**
 * Generic failure from the guardian path. Carries a fixed message and never any
 * raw Groq text, so a route can map it straight to a 503.
 */
export class GuardianUnavailableError extends Error {
  constructor(message = "The guardian is unavailable right now. Try again shortly.") {
    super(message);
    this.name = "GuardianUnavailableError";
  }
}

/** Harder tiers get more deliberation before answering. */
export function reasoningEffortFor(tier: Tier): "low" | "medium" | "high" {
  switch (tier) {
    case "APPRENTICE":
      return "low";
    case "ADEPT":
      return "medium";
    case "ARCHMAGE":
      return "high";
  }
}

/**
 * Sends the prompt history to the guardian and returns its reply.
 *
 * Non-streaming on purpose: the reply must be scanned in full for the secret
 * word before any of it reaches the client.
 *
 * `GuardianBusyError` is rethrown untouched so the route can render the
 * friendly 503; every other failure becomes an opaque GuardianUnavailableError
 * with no raw API text in it.
 */
export async function callGuardian(
  messages: ReadonlyArray<{ role: "user" | "assistant" | "system"; content: string }>,
  tier: Tier,
): Promise<string> {
  try {
    return await withGroqKey(async (client) => {
      const completion = await client.chat.completions.create({
        model: GUARDIAN_MODEL,
        messages: [...messages],
        reasoning_effort: reasoningEffortFor(tier),
        stream: false,
      });

      // Directly below, the response message is destructured for `content`
      // ONLY. gpt-oss-120b also returns a separate `reasoning` field, and that
      // is deliberately discarded here: it can contain the secret word or
      // describe the defence logic, so it is never read, logged, returned or
      // stored anywhere past this line.
      const { content } = completion.choices[0]?.message ?? {};

      if (typeof content !== "string" || content.length === 0) {
        throw new GuardianUnavailableError();
      }
      return content;
    });
  } catch (error) {
    if (error instanceof GuardianBusyError || error instanceof GuardianUnavailableError) {
      throw error;
    }
    throw new GuardianUnavailableError();
  }
}
