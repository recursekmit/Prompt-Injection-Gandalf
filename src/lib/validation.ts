export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 1000;

export type CredentialsResult =
  | { ok: true; email: string; password: string }
  | { ok: false; error: string };

/** Deliberately simple: shape check only, as the spec for this form asks. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The single parser shared by signup and the credentials provider, so the two
 * can never disagree about what counts as valid credentials.
 *
 * Email is trimmed and lowercased (otherwise one person can hold two accounts);
 * the password is left byte-for-byte as typed, since leading and trailing
 * spaces are legal password characters.
 */
export function readCredentials(input: unknown): CredentialsResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Email and password are required." };
  }

  const { email, password } = input as { email?: unknown; password?: unknown };

  if (typeof email !== "string" || typeof password !== "string") {
    return { ok: false, error: "Email and password are required." };
  }

  const normalisedEmail = email.trim().toLowerCase();

  if (normalisedEmail.length === 0) {
    return { ok: false, error: "Email is required." };
  }

  if (!EMAIL_SHAPE.test(normalisedEmail)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`,
    };
  }

  return { ok: true, email: normalisedEmail, password };
}
