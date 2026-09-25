export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// Zero-width and bidi controls: U+200B-U+200F, U+202A-U+202E,
// U+2060-U+2064, U+FEFF.
const ZERO_WIDTH_AND_BIDI = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

// Control characters, keeping \t (\u0009) and \n (\u000A) so line structure
// survives for the role-prefix neutralisation below.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

const ROLE_PREFIX = /^([ \t]*)(system|assistant|developer|admin)([ \t]*):/gim;

const PLAYER_TAG = /<\/?player>/gi;

/**
 * Sanitises one player message. Pure and total: given a string it always
 * returns a string, never throws, and never lets player text carry role
 * authority into the assembled conversation.
 */
export function sanitizeUserMessage(raw: string, maxLen = 2000): string {
  return raw
    .normalize("NFKC")
    .replace(ZERO_WIDTH_AND_BIDI, "")
    .replace(CONTROL_CHARS, "")
    .replace(ROLE_PREFIX, "$1[role-label-stripped]$3:")
    .replace(PLAYER_TAG, "")
    .slice(0, maxLen);
}

/**
 * Assembles typed turns ONLY. For every stored attempt a `user` turn
 * (sanitised here, at call time) is followed by its `assistant` turn, then the
 * new sanitised player message. Roles are never parsed out of message text:
 * that is the invariant that stops a player injecting a fake assistant turn.
 */
export function buildMessages(
  history: ReadonlyArray<{ userMessage: string; aiResponse: string }>,
  newMessage: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const turn of history) {
    messages.push({ role: "user", content: sanitizeUserMessage(turn.userMessage) });
    messages.push({ role: "assistant", content: turn.aiResponse });
  }
  messages.push({ role: "user", content: sanitizeUserMessage(newMessage) });
  return messages;
}
