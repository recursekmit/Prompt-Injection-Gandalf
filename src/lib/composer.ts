/**
 * Small, pure helpers the game screen needs at render time. Kept out of the
 * component file so the rules they encode — how two messages are compared, how
 * a timestamp reads — can be tested without a DOM.
 */

/**
 * Trims, lowercases and collapses runs of whitespace.
 *
 * This mirrors the server's comparison so the two agree on what "the same
 * message" means, but it is deliberately NOT a security control: the server
 * sanitises and enforces the rule. This exists so a repeat never costs a round
 * trip. If the two ever disagree, the server wins and the player sees its 409.
 */
export function normaliseMessage(message: string): string {
  return message.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Whether `message` repeats anything already sent in this level. */
export function isDuplicateMessage(
  message: string,
  history: ReadonlyArray<string>,
): boolean {
  const target = normaliseMessage(message);
  if (target === "") {
    return false;
  }
  return history.some((sent) => normaliseMessage(sent) === target);
}

/** What pressing send should do, decided before any request is made. */
export type SubmitPlan =
  | { readonly kind: "send"; readonly message: string }
  | { readonly kind: "refuse"; readonly reason: "duplicate" }
  | { readonly kind: "ignore" };

/**
 * The whole send decision, extracted from the composer so it can be tested
 * without a browser. The duplicate arm is the one that matters: it refuses
 * locally and instantly, and the comment it replaces lived on the `if` that
 * used to hold this logic — the client check is UX only, and the server is what
 * actually enforces the rule.
 */
export function planSubmit(input: {
  readonly draft: string;
  readonly history: ReadonlyArray<string>;
  readonly openForPlay: boolean;
  readonly sending: boolean;
}): SubmitPlan {
  const message = input.draft.trim();
  if (message === "" || !input.openForPlay || input.sending) {
    return { kind: "ignore" };
  }
  // UX only, deliberately: refusing here saves a round trip and gives instant
  // feedback. The server's 409 is the enforcement.
  if (isDuplicateMessage(message, input.history)) {
    return { kind: "refuse", reason: "duplicate" };
  }
  return { kind: "send", message };
}

const MINUTE = 60;

/**
 * A timestamp a player can read at a glance: relative while it is still "today",
 * absolute once it is not. `now` is injectable so the rule is testable.
 */
export function formatTimestamp(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) {
    return "";
  }

  const elapsedSeconds = Math.round((now.getTime() - then.getTime()) / 1000);

  // Future or same-day: relative. A clock skew that puts a message slightly in
  // the future should read as "just now", never as "in -1m".
  if (then.toDateString() === now.toDateString() || elapsedSeconds < 0) {
    if (elapsedSeconds < 45) {
      return "just now";
    }
    const minutes = Math.floor(elapsedSeconds / MINUTE);
    if (minutes < 60) {
      return `${minutes}m ago`;
    }
    const hours = Math.floor(minutes / 60);
    return `${Math.max(1, hours)}h ago`;
  }

  const sameYear = then.getFullYear() === now.getFullYear();
  const date = then.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const time = then.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date}, ${time}`;
}
