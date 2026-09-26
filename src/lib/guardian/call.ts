import Groq from "groq-sdk";
import type { ReasoningEffort } from "@/lib/guardian/levels";

const GUARDIAN_MODEL = "openai/gpt-oss-120b";

/** The caller's own Groq key hit its rate limit. Mapped to a friendly 503 with a distinct message. */
export class GuardianKeyRateLimitError extends Error {
  readonly retryable = false;
  constructor(message = "Your Groq key is rate-limited. Wait a moment and try again.") {
    super(message);
    this.name = "GuardianKeyRateLimitError";
  }
}

/** Generic guardian failure. Never carries raw Groq text. */
export class GuardianUnavailableError extends Error {
  readonly retryable = false;
  constructor(message = "The guardian is unavailable right now. Try again shortly.") {
    super(message);
    this.name = "GuardianUnavailableError";
  }
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

/**
 * Sends the prompt history to the guardian on the caller's own key and returns
 * its reply. Non-streaming on purpose: the reply is scanned for the secret word
 * before any of it reaches the client. Reads `content` only — the `reasoning`
 * field can contain the word and is never touched.
 */
export async function callGuardian(
  messages: ReadonlyArray<{ role: "user" | "assistant" | "system"; content: string }>,
  effort: ReasoningEffort,
  apiKey: string,
): Promise<string> {
  try {
    const client = new Groq({ apiKey });
    const completion = await client.chat.completions.create({
      model: GUARDIAN_MODEL,
      messages: [...messages],
      reasoning_effort: effort,
      stream: false,
    });
    const { content } = completion.choices[0]?.message ?? {};
    if (typeof content !== "string" || content.length === 0) {
      throw new GuardianUnavailableError();
    }
    return content;
  } catch (error) {
    if (error instanceof GuardianUnavailableError) throw error;
    if (statusOf(error) === 429) throw new GuardianKeyRateLimitError();
    throw new GuardianUnavailableError();
  }
}
