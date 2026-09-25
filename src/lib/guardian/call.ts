import { GuardianBusyError, withGroqKey } from "@/lib/groq-key-pool";
import type { ReasoningEffort } from "@/lib/guardian/levels";

/** The only model the guardian runs on. */
const GUARDIAN_MODEL = "openai/gpt-oss-120b";

/**
 * Generic failure from the guardian path. Carries a fixed message and never any
 * raw Groq text, so a route can map it straight to a 503.
 */
export class GuardianUnavailableError extends Error {
  /**
   * Read by the key pool's retry classifier. The request reached Groq and came
   * back; retrying it would spend another unit of quota on the same empty
   * answer. Only transport failures are worth a retry.
   */
  readonly retryable = false;

  constructor(message = "The guardian is unavailable right now. Try again shortly.") {
    super(message);
    this.name = "GuardianUnavailableError";
  }
}

/**
 * Characters per token assumed by the fallback estimate below. Deliberately
 * crude: it only runs when the SDK hands back no usage at all, and it can be off
 * by a wide margin in either direction.
 */
const CHARS_PER_TOKEN = 4;

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
  effort: ReasoningEffort,
): Promise<string> {
  try {
    return await withGroqKey(async (client, _keyIndex, reportTokens) => {
      const completion = await client.chat.completions.create({
        model: GUARDIAN_MODEL,
        messages: [...messages],
        reasoning_effort: effort,
        stream: false,
      });

      // Directly below, the response message is destructured for `content`
      // ONLY. gpt-oss-120b also returns a separate `reasoning` field, and that
      // is deliberately discarded here: it can contain the secret word or
      // describe the defence logic, so it is never read, logged, returned or
      // stored anywhere past this line.
      const { content } = completion.choices[0]?.message ?? {};

      // The token cost is reported before the content is judged: a reply that
      // came back empty still spent the tokens Groq billed, and undercounting
      // them would let the pool walk into a token 429. `usage.total_tokens` is
      // the SDK's own count of prompt + completion and already includes the
      // reasoning tokens, which count against the key's token budget; only when
      // the response carries no usable usage does this fall back to a
      // characters-derived estimate, which may be off by a wide margin.
      const usage = completion.usage;
      if (usage !== undefined && Number.isFinite(usage.total_tokens) && usage.total_tokens > 0) {
        reportTokens?.(usage.total_tokens);
      } else {
        const promptChars = messages.reduce((total, message) => total + message.content.length, 0);
        const replyChars = typeof content === "string" ? content.length : 0;
        reportTokens?.(Math.ceil((promptChars + replyChars) / CHARS_PER_TOKEN));
      }

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
